# `tools/release` — reproducible release artefacts

Builds the same three things a release publishes, from one script, on one laptop:

| Artefact | What it is |
|---|---|
| `starling-<version>-<os>-<arch>.tar.gz` | a single-file compiled CLI plus the built dashboard, license and readme |
| `SHA256SUMS` | `<64 hex>  <asset name>`, sorted by name — what `shasum -a 256` / `sha256sum` print |
| `manifest.json` | `{ version, commit, builtAt, assets: [{ name, os, arch, bytes, sha256 }] }` |
| `starling.rb` | the Homebrew formula, rendered from `homebrew/starling.rb.tmpl` |

**Nothing here publishes anything.** Uploading is a documented manual step at the bottom of this file.
There is no signing or notarisation (see "Known limits").

## The asset contract (shared with the installer)

This is copied verbatim into `docs/epic-151-packaging.md` and is what `tools/install` (Epic 152)
downloads. Do not change it without changing the installer in the same release.

- Asset name: `starling-<version>-<os>-<arch>.tar.gz` (`os` ∈ `darwin|linux`, `arch` ∈ `arm64|x64`),
  version without a leading `v`.
- Top-level directory: `starling-<version>-<os>-<arch>/` containing `bin/starling`,
  `share/starling/web/**`, `LICENSE`, `README.md`.
- `SHA256SUMS` lines: `<64 hex>  <asset name>` (two spaces), sorted by name.
- Release URL: `https://github.com/broiisapro/starling/releases/download/v<version>/<asset>`.

The three targets are `darwin-arm64`, `darwin-x64` and `linux-x64` (`targets.ts`). There is
deliberately no `linux-arm64` build: the installer names that combination as unsupported and points
at the build-from-source instructions.

## Try it without publishing

```sh
bash .orchestrator/bin/heavy.sh bun tools/release/dry-run.ts
```

Builds the host target into a temp directory, verifies the checksum, unpacks the tarball, runs
`bin/starling --version`, `--help` and `replay fixtures/runs/sky-todo-launch-day.jsonl --speed 1000`,
checks `share/starling/web/index.html` and renders the formula. Prints a ✓/✗ checklist and exits
non-zero on any ✗. `--keep` leaves the temp tree for inspection; `--skip-web` reuses
`apps/web/dist`.

Only the **host** target is built. Cross-compiling makes Bun download another platform's runtime
(network), which a smoke test must never need.

## Build for real

```sh
# the host only: fast, no network, and the first thing to check before a release
bun tools/release/build.ts --version 0.1.0 --target host

# every published asset (Bun downloads the non-host runtimes — run this on a good connection)
bun tools/release/build.ts --version 0.1.0 --target all

# reuse an existing dashboard build (CI builds it once)
bun tools/release/build.ts --version 0.1.0 --target all --skip-web
```

Output lands in `tools/release/dist/` (root `.gitignore` already ignores `dist/`). One target writes
one tarball; a full build also writes a formula with real hashes in every platform block. A partial
build writes a formula whose missing platforms `raise` a readable message — useful for a smoke test,
**never publish a partial formula**.

`--version` falls back to the root `package.json` version. The version is also baked into the binary
with `--define process.env.STARLING_VERSION='"<version>"'`.

## Cut a release by hand

1. Build everything: `bun tools/release/build.ts --version <version> --target all`.
2. Prove the host asset: `bash .orchestrator/bin/heavy.sh bun tools/release/dry-run.ts --version <version>`.
3. Verify the checksums the way a user would:

   ```sh
   cd tools/release/dist
   shasum -a 256 -c SHA256SUMS     # macOS
   sha256sum -c SHA256SUMS          # Linux
   ```

4. Inspect one tarball's layout:

   ```sh
   tar -tzf starling-<version>-linux-x64.tar.gz | head
   ```

5. Publish (documented only — no script in this repo runs these):

   ```sh
   gh release create v<version> \
     --title "Starling v<version>" \
     --notes "Starling v<version>" \
     tools/release/dist/starling-*.tar.gz \
     tools/release/dist/SHA256SUMS \
     tools/release/dist/manifest.json \
     tools/release/dist/starling.rb
   ```

6. Homebrew is also manual: copy the rendered `starling.rb` into the tap repository after the
   release exists (the URLs point at the release assets, so upload first).

`manifest.json` records the commit the assets came from; attach it even though the installer never
reads it, so a released binary can be traced back to a tree.

## Reproducibility

- **GNU tar** (Linux) gets `--sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner`, so two
  builds from the same source produce the same archive bytes.
- **bsdtar** (macOS) has no equivalent flags; the tarball is still correct but its bytes may differ
  between runs. The flavour is detected with `tar --version`, never assumed.
- `COPYFILE_DISABLE=1` keeps macOS AppleDouble `._*` files out of the tarball.
- `.DS_Store` is dropped when the dashboard is copied.
- The compiled binary itself is not bit-reproducible across Bun versions or platforms.

## Known limits

- **The compiled binary cannot find the dashboard yet.** `apps/cli` resolves `apps/web/dist`
  relative to `import.meta.dir`, which points into Bun's virtual filesystem in a compiled binary.
  The archive layout is already correct (`<root>/share/starling/web`); the CLI needs to honour
  `STARLING_WEB_DIST`, then `<dirname(process.execPath)>/../share/starling/web`. FIX REQUEST in
  `.orchestrator/handbacks/151-packaging.md` (Epic 203).
- **`starling --version` prints `0.0.0`** in a release binary until `program.version()` reads the
  baked `STARLING_VERSION`. Same handback (Epic 203).
- **No signing, notarisation, or stapling.** macOS Gatekeeper will warn on first run of an
  unsigned binary downloaded from the internet; Linux has no equivalent gate.
- **No release automation.** CI publishing, GitHub Releases, a Homebrew tap and Docker are later
  epics; this directory ends at files on disk.
- **No Windows build.** Bun can compile one; the CLI and installer do not support it yet.

## Files

| File | Purpose |
|---|---|
| `targets.ts` | the target matrix, host detection, asset/dir names, version normalisation |
| `build.ts` | `buildRelease()` (web build → per-target compile → tar → hashes → manifest → formula) and its CLI |
| `dry-run.ts` | the end-to-end host smoke test above |
| `checksums.ts` | real SHA-256 hashing, `SHA256SUMS` formatting/parsing/verification |
| `tar.ts` | GNU-vs-bsd detection and deterministic flags |
| `formula.ts` + `homebrew/starling.rb.tmpl` | the Homebrew formula renderer and its template |
| `version.ts` | `--version` → root `package.json` resolution |
| `exec.ts`, `fs-util.ts`, `report.ts` | injected process runner, filesystem helpers, ✓/✗ checklist |
| `*.test.ts` | 112 unit tests; no compiler, no network, temp dirs only |
