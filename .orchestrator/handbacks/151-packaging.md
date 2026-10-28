## Epic 151 Handback — Packaging: single-file binaries, checksums, Homebrew template

**Status:** Complete. Branch `epic/151-packaging` @ `71ec997` (this doc + handback land in the commit on top).

**Delivered:**
- `tools/release/targets.ts` — `TARGETS` (`darwin-arm64`, `darwin-x64`, `linux-x64`), `hostTarget()` (accepts `uname -m` spellings), `assetName()`, `topLevelDir()`, `targetId()`, `parseTargetId()`, `selectTargets()`, semver normalisation. Names are the Epic 152 contract.
- `tools/release/build.ts` — `buildRelease({ version, targets, outDir, webDist, exec, skipWebBuild, ... })`: builds the dashboard once (`bun run --cwd apps/web build`), then per target `bun build --compile --minify --sourcemap=none --target=<bunTarget> … --define 'process.env.STARLING_VERSION="<v>"'`, stages `bin/starling` + `share/starling/web/**` + `LICENSE` + `README.md` under `starling-<v>-<os>-<arch>/`, tars it, and writes `SHA256SUMS`, `manifest.json` and `starling.rb`. CLI: `--version`, `--target host|all|<os>-<arch>`, `--out`, `--skip-web`, `--help`.
- `tools/release/checksums.ts` — streaming `sha256File`, `formatChecksums` (sorted, `<hex>  <name>`), `parseChecksums`, `verifyChecksums` (reports mismatches/missing, never throws on a bad asset).
- `tools/release/tar.ts` — `detectTarFlavor` via `tar --version`; deterministic flags (`--sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner`) only on GNU tar; `COPYFILE_DISABLE=1` on every tar.
- `tools/release/formula.ts` + `homebrew/starling.rb.tmpl` — `renderFormula({ version, assets, repo })` with `on_macos`/`on_linux` → `on_arm`/`on_intel`, per-arch URL + sha256, `bin.install`, `pkgshare.install`, and a `test do` running `--version` and `--help`. A partial build renders `raise` for platforms it did not build, never a fake hash; `isCompleteFormula` tells a publishable one from a smoke one.
- `tools/release/dry-run.ts` — host-only end-to-end: web build → compile → checksum verify → extract → `bin/starling --version`, `--help`, `replay fixtures/runs/sky-todo-launch-day.jsonl --speed 1000` → `share/starling/web/index.html` → formula; ✓/✗ checklist with sizes, non-zero exit on any ✗; `--version`, `--skip-web`, `--keep`.
- `tools/release/version.ts` — `--version` → root `package.json`, strips `v`, rejects non-semver.
- `tools/release/exec.ts`, `fs-util.ts`, `report.ts` — injected exec seam, staging helpers (`.DS_Store` filtered), byte/checklist formatting.
- `tools/release/tsconfig.json` (like `tools/load`'s) and `tools/release/README.md` (manual release runbook + the asset contract + limits).
- 112 unit tests across 8 files, none compiling anything or touching the network.

**Key design decisions:**
- **GNU vs bsd tar detection instead of a fixed flag set.** Handing `--sort=name` to macOS bsdtar is a hard error; the build detects, uses the flags on GNU only, and documents that macOS tarballs are not byte-reproducible. The alternative (requiring GNU tar) would break the primary dev machine.
- **A partial build renders a `raise` for missing platforms.** The dry run and `--target host` cannot know the other platforms' hashes. A fake `sha256` or `:no_check` would weaken a real install, so the formula refuses with a readable message and only a `--target all` build is publishable. This also satisfies DoD item 4 (`starling.rb` from a host build) honestly.
- **Real streaming SHA-256 via `node:crypto`.** Releases are 39 MB compressed / 85 MB uncompressed; `readFile` would be a pointless spike, and a reimplementation of sha256 would defeat the checksum's purpose.
- **No compile in the default test suite.** L35 plus ~100 parallel agents made a 110 MB compile test unacceptable. The fake `exec` writes placeholder bytes and the tests assert the exact argv, the staging layout at tar time, real hashes of the tiny fake tarballs, manifest shape, formula content and CLI parsing; `dry-run.ts` is the one real compile (gated).
- **`STARLING_VERSION` is baked in now** even though nothing reads it in this worktree (Epic 145/203); it costs one argv element and makes today's artefacts correct once the CLI reads it.
- **`manifest.json` uses an ISO-8601 `builtAt` and a short `commit`** — provenance for humans, not an installer input (the brief left the exact shape open).
- **`tools/release` imports core by path** (`../../packages/core/src/index.ts`) because `tools/` is not a Bun workspace and root config is out of lane — the same pattern as `tools/stats`.

**Verification (exact commands + results):**
- `bun install` (worktree): `Checked 172 installs across 225 packages (no changes)`; `git status --short bun.lock` → empty.
- `bun test tools/release`: `112 pass / 0 fail`, 8 files, 200 expect() calls, ~0.25 s.
- `bunx tsc --noEmit -p tools/release`: clean (no output).
- `bash .orchestrator/bin/heavy.sh bun tools/release/dry-run.ts`: exit 0, all ✓ —
  ```
  starling release dry run · v0.0.0 · darwin-arm64
    ✓ asset name matches the installer contract  starling-0.0.0-darwin-arm64.tar.gz · 39.4 MB
    ✓ SHA256SUMS verifies  1 asset · 59925ff07aa2…
    ✓ tarball extracts  starling-0.0.0-darwin-arm64
    ✓ bin/starling is present
    ✓ share/starling/web/index.html is present  the path the compiled-binary dashboard fix (FIX REQUEST · Epic 203) expects
    ✓ LICENSE + README.md are present
    ✓ bin/starling --version  prints "0.0.0"
    ✓ bin/starling --help
    ✓ bin/starling replay <launch-day fixture>  252 events · exit 0
    ✓ formula renders  starling.rb · sha256 inserted

  SHA256SUMS  59925ff07aa2a561aabe3ff6ad1bd1d3da2ba84d14c230816e0d87fc25825e43  starling-0.0.0-darwin-arm64.tar.gz
  archive     …/starling-0.0.0-darwin-arm64.tar.gz (39.4 MB)
  all green — nothing was published
  ```
  (dry run defaults to the root `package.json` version, `0.0.0`, per the brief's version order.)
- `bash .orchestrator/bin/heavy.sh bun tools/release/build.ts --version 0.1.0 --target host --skip-web`: wrote
  `starling-0.1.0-darwin-arm64.tar.gz` (39.4 MB), `SHA256SUMS`, `manifest.json`, `starling.rb` into
  `tools/release/dist/`; `git status --short --untracked-files=all` lists nothing from `dist/`
  (root `.gitignore`'s `dist/` covers it). `SHA256SUMS`:
  `2caadcf65f96616b92aacfd8b69e3cf120d06ddebf3e9eeb1b32638ca7b356fa  starling-0.1.0-darwin-arm64.tar.gz`.
  `tar -tzf` confirms the single top-level dir with `bin/`, `share/starling/web/`, `LICENSE`, `README.md`.
- `bash .orchestrator/bin/heavy.sh bun run test` (root):
  - packages half: `2050 pass / 4 skip / 0 fail` — `Ran 2054 tests across 231 files. [62.90s]`
  - web half: `581 pass / 0 fail` — `Ran 581 tests across 60 files. [5.81s]`
- `bash .orchestrator/bin/heavy.sh bun run check`: Biome `Checked 996 files … No fixes applied`; the
  per-workspace `tsc --noEmit` loop printed no errors.

**Dependencies added:** none.

**Carryover done:**
- `.orchestrator/fix-requests-w2.md` has **no request targeting `tools/release/**`** (the lane did not
  exist in Wave 2). Nothing to implement; nothing declined. The nearest Wave 2 asks (root `package.json`
  scripts, `tools/*` in the workspace) are root-config changes and are filed below instead.

**C3 wiring:** none required. This epic exports no package entry and touches no shared registration
file; both scripts run standalone. If C3 wants convenience scripts, the exact addition to root
`package.json#scripts` is:
```json
"release:build": "bun tools/release/build.ts",
"release:dry-run": "bun tools/release/dry-run.ts"
```
and, to have `bun run check` cover this lane, extend the root `typecheck` loop from
`for d in packages/* apps/*` to `for d in packages/* apps/* tools/*` (or add a `tools/release` line).

**FIX REQUESTS:**
1. **Epic 203 / `apps/cli` — resolve the dashboard from the install layout.** `apps/cli` (Epic 40's
   `real/dashboard.ts` / `resolveWebDist`, not present in this worktree yet) must look in this order:
   `process.env.STARLING_WEB_DIST`, then `<dirname(process.execPath)>/../share/starling/web`, then
   the current source-tree `apps/web/dist`. The tarball already ships the second path; without this,
   a compiled binary cannot serve the dashboard. Sketch:
   ```ts
   const fromEnv = process.env.STARLING_WEB_DIST;
   if (fromEnv) return fromEnv;
   const besideBinary = join(dirname(process.execPath), '..', 'share', 'starling', 'web');
   if (existsSync(join(besideBinary, 'index.html'))) return besideBinary;
   return join(import.meta.dir, '../../../web/dist');
   ```
2. **Epic 203 / `apps/cli/src/program.ts` — `program.version()` should read the baked value.**
   Today line 83 is `.version('0.0.0', …)`, so a `v0.1.0` release prints `0.0.0`. Change to
   `.version(process.env.STARLING_VERSION ?? '0.0.0', …)`; `build.ts` already passes
   `--define process.env.STARLING_VERSION`.
3. **Integrator / root `package.json` — let `bun run check` typecheck `tools/*`.** `tools/release`
   passes `bunx tsc --noEmit -p tools/release` but the root loop only covers `packages/*` and
   `apps/*`, so this new lane is unguarded in CI until the workspace/typecheck change lands.
4. **Future release-automation epic — upload, do not rebuild per platform.** A tag workflow should
   run `bun run --cwd apps/web build` once, then `bun tools/release/build.ts --target all --skip-web`
   on one GNU-tar runner, and upload `dist/*.tar.gz`, `SHA256SUMS`, `manifest.json`, `starling.rb`
   with `gh release create`. Publishing is deliberately not in this lane.

**Deliberately deferred / out of scope:**
- Publishing (GitHub Releases, Homebrew tap, npm), signing/notarisation, Docker, CI release workflow
  — as instructed.
- `apps/cli` changes to locate/embed the web dist (FIX REQUESTS 1–2).
- Windows and linux-arm64 artefacts; the installer names both as unsupported.
- Bit-reproducibility on macOS (bsdtar has no deterministic flags).
- A `*.slow.test.ts` real compile in the default suite; the gated dry run is the real check.

**Open questions / flagged tradeoffs:**
- **Partial formula policy.** Publishing a formula anyway would need hashes for platforms that were
  not built; the chosen behaviour is a `raise` in the missing block. If a future CI builds one
  platform per job and merges formulas, someone must decide how the partial formulas are combined —
  today only `--target all` is publishable.
- **macOS artefacts are not byte-reproducible**, so "reproducible builds" is a Linux promise only.
  A future CI could build all three with GNU tar cross-compiling from Linux, at the cost of macOS
  runtime downloads on the builder.
- **The dry run reports `v0.0.0`** because it follows the documented "package.json fallback" rule
  while the repo is still pre-release. If the orchestrator prefers the dry run to exercise a
  realistic name, `--version 0.1.0` is one flag (do not change the fallback order).
- **`bin/starling --version` in the dry run prints `0.0.0`** until FIX REQUEST 2 lands; the check is
  exit-code based on purpose so it does not turn red for a known, separately-owned gap.
