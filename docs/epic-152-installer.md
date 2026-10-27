# Epic 152 — Install script: `curl | sh` with checksum verification

## Goal

Make the README quickstart one line: `curl -fsSL …/install.sh | sh`. This epic ships that installer
and its uninstaller as careful POSIX `sh`, so a user with a shell, `curl` and no build tools gets a
working `starling` in `~/.starling` — and so a tampered or truncated download never installs.

The bar was not "it works on my Mac": the scripts must run under `dash` and macOS `/bin/sh`, refuse
to install anything that fails the checksum, be idempotent, explain each failure in one friendly
line, and be tested against a local fake release host so nothing in the suite touches GitHub.

## How it works

`tools/install/install.sh`:

1. Parses flags (`--version`, `--dir`, `--modify-path`, `--quiet`, `--help`; unknown → exit 2 with
   usage). Environment: `STARLING_VERSION`, `STARLING_INSTALL_DIR`, `STARLING_RELEASE_BASE_URL`,
   `STARLING_UNAME_S`/`STARLING_UNAME_M`, `STARLING_NO_MODIFY_PATH`,
   `STARLING_INSECURE_SKIP_VERIFY`.
2. Maps `uname -s` → `darwin|linux` and `uname -m` → `arm64|x64` (`aarch64` → `arm64`,
   `x86_64`/`amd64` → `x64`). The supported matrix is `darwin-arm64 darwin-x64 linux-x64`;
   anything else exits 1 with the list and the build-from-source link.
3. Picks `curl -fsSL` or `wget -qO-`, and `sha256sum` or `shasum -a 256`. No downloader, or no
   checksum tool, is a hard failure with a one-line hint (unless
   `STARLING_INSECURE_SKIP_VERIFY=1`, which warns loudly and continues).
4. Creates a `mktemp -d` workspace and a `trap … EXIT` that removes it on success, failure or
   signal.
5. Downloads `SHA256SUMS` first. For `latest`, the asset name — and therefore the version — is
   parsed out of the manifest; for a pinned version the name is constructed and the manifest is
   fetched from `download/v<version>/`.
6. If `VERSION`, `bin/starling` (executable) and `share/starling/web` all match the version being
   installed, prints "already installed" and exits. A pinned re-run therefore makes **zero**
   requests; a `latest` re-run makes one (the manifest).
7. Downloads the archive, verifies the SHA-256 against the manifest line, extracts it, checks the
   `bin/starling` and `share/starling/web` layout, and runs the freshly extracted binary once —
   before touching the existing install.
8. Stages `bin/starling.new` and `share/starling/web.new`, then swaps them in and writes `VERSION`.
9. Prints the exact PATH line for `$SHELL` (zsh → `~/.zshrc`, bash → `~/.bash_profile` on macOS and
   `~/.bashrc` elsewhere, fish → `fish_add_path` in `~/.config/fish/config.fish`). `--modify-path`
   appends it once, behind the marker `# added by starling installer`.
10. Runs the installed `starling --version`, then prints the bird and the next commands
    (`starling try`, `starling doctor`).

`tools/install/uninstall.sh` removes `bin/starling`, `share/starling`, `VERSION` and only marker
lines from the four rc files. It keeps `perch/` and any other user data unless `--purge`, tidies
empty `bin/`/`share/` directories, and is safe to run twice.

## Key decisions & reasoning

- **`latest` is resolved from `SHA256SUMS`, not from an API.** The asset name embeds the version
  (`starling-1.4.2-darwin-arm64.tar.gz`), so scanning the manifest gives both the version and the
  exact file name with the one request the installer already needs. Alternatives were the GitHub
  REST API (rate limits, a second host, and a parser for JSON in `sh`) and scraping the
  `/releases/latest` redirect (HTML, brittle). This also means a mirror that serves the documented
  URL shapes works unchanged.
- **The marker sits on the same line as the PATH entry.** `<export …>  # added by starling
  installer` is one line, so "remove lines with the marker" removes the whole entry and never
  leaves a dangling `export PATH`. Detecting an existing entry is the same `grep -F`.
- **Verification happens before any write to `$INSTALL_DIR`.** A mismatch, a missing manifest line
  or a missing `bin/starling` leaves an existing install untouched and the install directory
  possibly not even created — which is what the tests assert.
- **The new binary is executed before the swap.** A release for the wrong architecture fails with
  "the downloaded binary does not run on this machine" instead of replacing a working install with
  something that cannot start.
- **Pinned re-runs are answered offline.** The no-op check runs before the downloader is used, so
  `install.sh --version 1.0.0` on a machine that already has 1.0.0 works on a plane. `latest`
  necessarily needs the manifest to know what "latest" is.
- **Tarballs are generated in-process (`tools/install/tarball.ts`).** The fake host writes ustar
  headers with zero timestamps and gzips them with `node:zlib`; no `tar` subprocess, identical
  bytes per run, and the layout is the Epic 151 contract written down as code.
- **Tests run the real scripts, not a reimplementation.** `test-harness.ts` spawns `sh` (or `dash`)
  with a throwaway `HOME`, `TMPDIR` and install dir, and refuses any `STARLING_RELEASE_BASE_URL`
  that is not `http://127.0.0.1:<port>`. That guard is why the suite can claim "no network".
- **`--version` takes a value, as specified.** It is not the conventional "print my version" flag;
  the version of the installed tool is printed by `starling --version`.

## Interfaces for future epics

- **Epic 151 (packaging)** must produce exactly `starling-<version>-<os>-<arch>.tar.gz` for
  `darwin-arm64`, `darwin-x64`, `linux-x64`, with the top-level directory and `SHA256SUMS` lines
  described above. If the matrix grows (e.g. `linux-arm64`), the only changes here are the
  `SUPPORTED` string in both scripts and `SUPPORTED_PLATFORMS` in `tools/install/tarball.ts`, plus
  a test case.
- **Epic 172 (README)** links the raw script
  (`https://raw.githubusercontent.com/broiisapro/starling/main/tools/install/install.sh`); hosting it
  on a pretty domain is out of scope here.
- **Other tooling** can reuse `tools/install/tarball.ts` (`makeReleaseTarball`, `assetName`,
  `SUPPORTED_PLATFORMS`, `releaseEntries`) and `fake-release.ts` (`startFakeRelease` →
  `Promise<{ baseUrl, version, requests, sumsText, stop() }>`) to exercise anything that downloads
  a release, without GitHub.
- **C3 wiring:** none. This lane ships a self-contained `tools/install/` module; no shared
  registration file changes.

## Deviations from plan

- The prompt listed `startFakeRelease` as returning a `Promise`; the first draft was synchronous.
  The final API is `async`, matching the brief.
- A pinned install whose manifest line is missing fails at verification ("SHA256SUMS has no entry
  for …") rather than at name resolution — the pinned asset name is constructed directly, which is
  both simpler and makes the missing-line path reachable and tested.
- `--version` accepts a leading `v` (`--version v1.2.3`) as a convenience; the canonical form has
  no `v`.
- An empty `--dir ''` is rejected with a hint instead of trying to `mkdir ''`.

## Known limitations / deferred

- **SHA-256 is integrity, not authenticity.** The checksum comes from the same host as the archive,
  so TLS (and the user's trust in the release host) is the real trust anchor; a compromised release
  host could serve a matching pair. Signing releases (minisign/sigstore) is a separate epic.
- **`linux-arm64` is refused**, per Epic 151's matrix.
- **Uninstall only knows four rc files** (`~/.zshrc`, `~/.bashrc`, `~/.bash_profile`,
  `~/.config/fish/config.fish`). Other shells get a printed line, not automation.
- **Downgrades are allowed**: installing 0.9 over 1.0 replaces it, with no warning beyond the
  version change. A "refuse downgrade" flag was not requested.
- **`wget` is exercised through a shim in the tests** (this macOS has no `wget`); the URL and
  argument shape are covered, but not a specific wget build's quirks.
- **No Windows/PowerShell**, no `sudo` path, no install into `/usr/local/bin`.
- **`tools/*` is outside the root typecheck loop**, so `tools/install` is typechecked with
  `bunx tsc --noEmit -p tools/install` rather than by `bun run check` (see the FIX REQUEST in the
  handback; same gap as `tools/stats`).
