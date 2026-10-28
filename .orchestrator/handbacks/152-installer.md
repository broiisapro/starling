## Epic 152 Handback — Install script: `curl | sh` with checksum verification

**Status:** Complete. Branch `epic/152-installer` @ `71da80a` (this handback lands on top).

**Delivered:**
- `tools/install/install.sh` — POSIX `sh` installer: platform detection (`darwin|linux` ×
  `arm64|x64`), `curl`/`wget` downloader selection, `SHA256SUMS` verification via
  `sha256sum`/`shasum`, `latest` resolution from the manifest's asset names, atomic-ish staged
  install into `$STARLING_INSTALL_DIR` (default `~/.starling`), `VERSION` file, shell-aware PATH
  hint, `--modify-path` with the `# added by starling installer` marker, success line + next
  commands. Flags: `--version <v>`, `--dir <path>`, `--modify-path`, `--quiet`, `--help`; unknown
  → exit 2.
- `tools/install/uninstall.sh` — removes `bin/starling`, `share/starling`, `VERSION` and only the
  marker lines from `~/.zshrc`, `~/.bashrc`, `~/.bash_profile`,
  `~/.config/fish/config.fish`; keeps `perch/` unless `--purge`; idempotent; same
  `--dir`/`--quiet`/`--help` surface.
- `tools/install/tarball.ts` — in-process ustar + gzip release archives matching the Epic 151
  layout, with `assetName`, `SUPPORTED_PLATFORMS`, `releaseEntries`, `makeReleaseTarball`.
- `tools/install/fake-release.ts` — `startFakeRelease({ version, platforms?, corrupt?, omitSums?,
  omitSumsFor? })` → `Promise<{ baseUrl, version, requests, sumsText, stop() }>`, a loopback
  `Bun.serve` host for both URL shapes, `SHA256SUMS`, 404s for unbuilt platforms, and checksum or
  payload corruption.
- `tools/install/install.test.ts`, `uninstall.test.ts`, `scripts.test.ts` — 56 tests (≥ the 20
  required) driving the real scripts with a throwaway HOME/TMPDIR, plus `sh -n`/`dash -n` and a
  bashism lint. `test-harness.ts` refuses a non-loopback release URL.
- `tools/install/tsconfig.json` (typechecked like `tools/load`), `tools/install/README.md`,
  `docs/epic-152-installer.md`.

**Key design decisions:**
- `latest` is resolved by scanning `latest/download/SHA256SUMS` for our asset name — one request,
  no GitHub API, no HTML parsing, and mirrors work unchanged.
- The PATH marker lives on the entry line itself, so uninstall removes exactly the line it added.
- Verification (and `bin/starling` layout + a trial run of the new binary) happens **before**
  anything is written to the install directory; the old install survives every failure.
- Pinned same-version re-runs are answered before any download (zero requests, works offline);
  `latest` re-runs fetch only the manifest.
- Archives are generated in TypeScript with zero timestamps: deterministic bytes, no host `tar`.
- Tests spawn `sh`/`dash` against `127.0.0.1` only; the harness throws on any other base URL.

**Verification (exact commands + results):**
- `bun install` — `Checked 172 installs across 225 packages (no changes)`; `git status` clean, `bun.lock` untouched.
- `bun test tools/install` — `56 pass, 0 fail, 212 expect() calls, Ran 56 tests across 3 files`.
- `bunx tsc --noEmit -p tools/install` — clean.
- `sh -n tools/install/install.sh && sh -n tools/install/uninstall.sh` — clean; `dash -n` clean (both asserted in `scripts.test.ts`, and a full install runs under `/bin/dash`).
- Manual run against the fake host (`startFakeRelease({version:"1.0.0"})` on `127.0.0.1:53554`):
  ```
  Fetching the release manifest from http://127.0.0.1:53554/latest/download/SHA256SUMS
  Downloading starling-1.0.0-darwin-arm64.tar.gz
  Verified SHA-256 ae3fe4e7d692f9016aeb9300346ace031d9041dba0ed4b1b9de4184b555be08c

  Add Starling to your PATH by putting this line in /Users/moksh/.zshrc:
    export PATH="/tmp/st-home/.starling/bin:$PATH"  # added by starling installer
  Or re-run this installer with --modify-path.

  🐦 Starling 1.0.0 is installed at /tmp/st-home/.starling (starling 1.0.0)

  Next steps:
    starling try       start a tiny demo run
    starling doctor    check git, opencode and models
  ```
  `ls -R /tmp/st-home/.starling | head` → `bin/starling`, `share/starling/web/index.html`, `VERSION`.
  Uninstall:
  ```
  Removed /tmp/st-home/.starling/bin/starling
  Removed /tmp/st-home/.starling/VERSION
  Removed /tmp/st-home/.starling/share/starling
  ```
  (`/tmp/st-home/.starling` remained, empty — expected, it is the user-data root.)
- `bash .orchestrator/bin/heavy.sh bun run test` (root): packages/apps/tools/evals half
  `1994 pass, 4 skip, 0 fail, 29 snapshots, 8839 expect() calls, Ran 1998 tests across 226 files`;
  web half `581 pass, 0 fail, 4164 expect() calls, Ran 581 tests across 60 files`.
- `bash .orchestrator/bin/heavy.sh bun run check` — `Checked 983 files in 294ms. No fixes applied.` and the per-workspace `tsc --noEmit` loop completed (exit 0).

**Dependencies added:** none.

**Carryover done:** none — no request in `.orchestrator/fix-requests-w2.md` targets `tools/install/**`.

**C3 wiring:** none. `tools/install/` is self-contained; no shared registration file (`apps/cli/src/program.ts`, `apps/server/src/app.ts`, package `index.ts`) needs an entry. The README quickstart link for Epic 172 is documented in `tools/install/README.md`.

**CONTRACT REQUESTS:** none.

**FIX REQUESTS:**
1. **Root `package.json` (`typecheck` script) + `tools/install` (integrator / Epic 40's lane).** A
   repeat of the `tools/stats` gap: `"typecheck": "for d in packages/* apps/*; do …"` does not
   typecheck `tools/*`, so this lane is checked with `bunx tsc --noEmit -p tools/install` only.
   Minimal fix, add-only:
   ```json
   "typecheck": "for d in packages/* apps/* tools/*; do tsc --noEmit -p \"$d/tsconfig.json\" || exit 1; done"
   ```
   (`tools/flock`, `tools/load`, `tools/local-models`, `tools/security`, `tools/stats`,
   `tools/stress`, `tools/github-sandbox` and `tools/install` all have a `tsconfig.json`; each was
   green when last run. `tools/fully-open` has none and would need excluding.)

**Deliberately deferred / out of scope:**
- Building or publishing release assets (Epic 151), Windows/PowerShell, `sudo` installs.
- A pretty install URL / README quickstart edit (Epic 172).
- Installing Bun, opencode or git (hints only; `starling doctor` owns the checks).
- Release signing (minisign/sigstore); SHA-256 is integrity, TLS is the trust anchor.
- A `--no-downgrade` policy and shell support beyond zsh/bash/fish.
- Real `wget` binary coverage (this machine has none; a shim exercises the code path).

**Open questions / flagged tradeoffs:**
- **`latest` costs one manifest request per re-run.** Acceptable and documented; caching the last
  manifest would make "latest" lie more often than it saves.
- **`--version` is a value flag**, as the prompt specifies, so it cannot double as "print the
  installer's version". If a future CLI convention expects `install.sh --version` with no value,
  that would be a breaking change to this surface.
- **Checksums come from the same host as the archive.** Good against truncation and mirror
  tampering with the file, not against a compromised release host; signing is the next step.
- **The supported matrix is duplicated in two places** (`SUPPORTED` in the scripts,
  `SUPPORTED_PLATFORMS` in `tarball.ts`). Tests keep them honest for the current three combos, but
  adding `linux-arm64` is a two-file change plus a test.
- **`bun test tools/install` runs 56 tests in ~8 s**, dominated by real process spawns. That is
  deliberate — the subject is a shell script — but it is the slowest tool suite per assertion in
  `tools/`.

Closes #162
