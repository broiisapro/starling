# Epic 151 — Packaging: single-file binaries, checksums, Homebrew template

## Goal

Make a Starling release reproducible from one script, without publishing anything: compiled
single-file binaries for the three supported platforms, each in a tarball with the built dashboard,
a `SHA256SUMS` file, a rendered Homebrew formula, and a dry run that builds the host artefact and
smoke-tests the binary end to end.

The reason this is an epic and not a shell snippet is the **installer contract**: Epic 152's
`tools/install` downloads a name and unpacks a layout. Both sides must agree exactly, and only a
tested generator plus a green dry run makes that safe.

## How it works

`tools/release` is a small library plus two scripts. Everything that leaves the process goes through
an injected `ExecFn`, which is why the 112 unit tests finish in ~240 ms without a compiler.

| File | What it does |
|---|---|
| `targets.ts` | `TARGETS` (darwin-arm64, darwin-x64, linux-x64), `hostTarget()`, `assetName()`, `topLevelDir()`, `parseTargetId()`, `selectTargets()`, semver normalisation. |
| `version.ts` | `--version` wins, else the root `package.json`; `v0.1.0` → `0.1.0`; non-semver is an error. |
| `build.ts` | `buildRelease()`: build the dashboard once (`bun run --cwd apps/web build`, unless `skipWebBuild`), then per target compile → stage → tar → hash; writes `SHA256SUMS`, `manifest.json`, `starling.rb`. `compileCommand()` and `parseBuildArgs()` are exported for tests. |
| `dry-run.ts` | builds the host into a temp dir, verifies the checksum, unpacks it, runs `--version` / `--help` / `replay <launch-day fixture>`, checks the dashboard path, renders the formula, prints a ✓/✗ checklist. |
| `checksums.ts` | streaming `sha256File`, `formatChecksums` (sorted, two spaces), `parseChecksums`, `verifyChecksums`. |
| `tar.ts` | `detectTarFlavor()` from `tar --version`; `tarCommand()` adds GNU's reproducible flags only on GNU tar. |
| `formula.ts` + `homebrew/starling.rb.tmpl` | fills version/URLs/hashes; a partial build renders `raise` for platforms it did not build, never a fake hash. |
| `exec.ts`, `fs-util.ts`, `report.ts` | process seam, staging filesystem helpers, byte/checklist formatting. |

A build, step by step:

1. Resolve version, repo root, output dir (`tools/release/dist` by default), commit (short `git
   rev-parse`, `unknown` outside a checkout) and tar flavour.
2. Build the dashboard once (unless `--skip-web`) and require `apps/web/dist/index.html`.
3. Per target: create `<out>/.staging/starling-<v>-<os>-<arch>/`, compile with
   `bun build --compile --minify --sourcemap=none --target=<bunTarget> --define
   'process.env.STARLING_VERSION="<v>"' apps/cli/src/index.ts --outfile <staging>/bin/starling`,
   copy the dashboard into `share/starling/web`, copy `LICENSE` and `README.md`, then
   `tar -czf <out>/<asset> -C <out>/.staging [gnu flags] <top-dir>`.
4. Hash each tarball, sort by name, write `SHA256SUMS`, `manifest.json` and `starling.rb`, and
   delete the staging tree (also removed early if a target fails).

The dry run then treats the tarball as a consumer would: `SHA256SUMS` verification, extraction into a
second temp dir, and execution of the extracted `bin/starling`. It prints the tarball size and the
`SHA256SUMS` line so a reviewer can check them against the release page by eye.

## Key decisions & reasoning

- **Archive the staging directory's single top-level dir with `tar -C parent top`.** Using `tar -czf
  out top` from inside the parent would embed `.`-relative paths on some tars; `-C` plus the bare
  dir name produces exactly `starling-<v>-<os>-<arch>/…` on GNU tar and bsdtar, which is what the
  installer's `tar -xzf` expects.
- **GNU/bsd detection, not a flag assumption.** GNU tar determinism flags are a hard error on
  bsdtar. The build detects with `tar --version`, uses the flags only on GNU, and documents that
  macOS tarballs are not byte-reproducible. The alternative — requiring GNU tar on macOS — would
  make the release script unusable on the primary dev machine.
- **Real hashing through `node:crypto` and streams.** The binary is 85–110 MB; `readFile` would be a
  pointless memory spike, and a hand-rolled hash would defeat the point of a checksum. Tests hash
  tiny real files (including the `sha256("abc")` NIST vector).
- **The formula only claims what the build produced.** A partial build (dry run, host-only smoke)
  has no hashes for the other platforms, so those blocks `raise` a clear message. A fake `sha256`
  or a `sha256 :no_check` would silently weaken a real install; refusing is better. Only a
  `--target all` build produces a publishable formula.
- **`--define process.env.STARLING_VERSION` even though nothing reads it yet.** Epic 145's
  `starling version` (not in this worktree) and Epic 203's `program.version()` need the value baked
  in; adding it now costs one argv element and means a release built today is already correct once
  the CLI read lands.
- **No 110 MB compile in the default suite.** The brief forbids a slow compile test with ~100 agents
  on the box; the injected-`exec` tests assert the exact argv, the staging layout at tar time, the
  manifest, the checksums and the formula, and `dry-run.ts` is the one real compile (manual / gated).
- **`tools/release` imports `packages/core` by path.** `tools/` is not a Bun workspace (same
  constraint as `tools/stats`), and this epic may not change root `package.json`. `tools/release`
  uses core only for `StarlingError`; a FIX REQUEST already asks for `tools/*` to join the
  workspace.
- **`builtAt` is an ISO-8601 string, `commit` a short sha.** `manifest.json` is for humans and
  provenance, not for the installer; ISO time is unambiguous in a release note.

## Interfaces for future epics

**Shared with Epic 152 (installer), quoted verbatim — do not change one side alone:**

- Asset name `starling-<version>-<os>-<arch>.tar.gz` (`os` ∈ `darwin|linux`, `arch` ∈ `arm64|x64`),
  top-level dir `starling-<version>-<os>-<arch>/` with `bin/starling` and `share/starling/web/`,
  checksums in `SHA256SUMS` as `<hex>  <name>`, release URL
  `https://github.com/broiisapro/starling/releases/download/v<version>/<asset>`.

Exported surface (importable by a later CI workflow, not by the installer):

```ts
// targets.ts
export const TARGETS: readonly { os: 'darwin'|'linux'; arch: 'arm64'|'x64'; bunTarget: string }[];
export type Target; export type TargetOs; export type TargetArch;
export function hostTarget(platform?: string, arch?: string): Target;
export function targetId(target: Target): string;              // 'darwin-arm64'
export function parseTargetId(id: string): Target;
export function selectTargets(spec: string, host?: Target): readonly Target[];
export function normalizeVersion(version: string): string;
export function topLevelDir(version: string, target: Target): string;
export function assetName(version: string, target: Target): string;

// build.ts
export interface ReleaseAsset { name: string; os: TargetOs; arch: TargetArch; bytes: number; sha256: string }
export interface ReleaseManifest { version: string; commit: string; builtAt: string; assets: ReleaseAsset[] }
export function buildRelease(options: BuildReleaseOptions): Promise<ReleaseManifest>;
export function compileCommand(input: { version: string; target: Target; entry: string; outfile: string }): string[];

// checksums.ts / tar.ts / formula.ts
export async function sha256File(path: string): Promise<string>;
export function formatChecksums(entries: readonly { name: string; sha256: string }[]): string;
export function parseChecksums(text: string): { name: string; sha256: string }[];
export async function verifyChecksums(entries, dir, hash?): Promise<VerifyResult>;
export async function detectTarFlavor(exec: ExecFn, cwd: string): Promise<TarFlavor>;
export function tarCommand(input: TarCommandInput): string[];
export function renderFormula(options: RenderFormulaOptions): string;
export function releaseBaseUrl(version: string, repo?: string): string;

// dry-run.ts
export function dryRun(options?: DryRunOptions): Promise<DryRunResult>;
```

The CLI surfaces are `bun tools/release/build.ts [--version <v>] [--target host|all|<os>-<arch>]
[--out <dir>] [--skip-web]` and `bun tools/release/dry-run.ts [--version <v>] [--skip-web] [--keep]`.

**For a future release-workflow epic:** run `bun run --cwd apps/web build` once, then
`build.ts --target all --skip-web`; upload `dist/*.tar.gz`, `SHA256SUMS`, `manifest.json` and
`starling.rb` with `gh release create v<version>`. The scripts never publish.

## Deviations from plan

- **The formula is conditional on a full build.** The brief describes one formula with all platform
  blocks; that is what `--target all` renders. To keep host-only builds honest (and DoD item 4,
  which requires `starling.rb` from a `--target host` build) the missing platforms render a `raise`
  rather than a made-up hash. Documented in the README and the formula template header.
- **`manifest.json`'s `commit` is the short sha** (12 chars in practice), not the full 40; the
  brief does not specify a length and a short sha is what a human pastes into `git show`.
- **`builtAt` is an ISO-8601 string**, not epoch ms, for readability in a release artefact.
- **`--out` resolves relative to the current working directory**, not the repo root; the default is
  still `<repoRoot>/tools/release/dist` because the default is computed from the repo root.
- **`--version` on `dry-run.ts` is additive** to the brief (useful for checking a specific tag
  without editing `package.json`).
- **No `apps/cli` change for the dashboard path.** The archive layout is correct and the dry run
  proves it; the reader is a FIX REQUEST for Epic 203, per the brief.
- **112 unit tests instead of ≥ 25.** The target/CLI/checksum/formula/build matrices are cheap and
  deterministic, so there was no reason to stop at the minimum.

## Known limitations / deferred

- **A compiled binary cannot show the dashboard yet.** `apps/cli` resolves `apps/web/dist` from
  `import.meta.dir`, which points into Bun's virtual filesystem inside `--compile`. The correct
  lookup order is `STARLING_WEB_DIST` → `<dirname(process.execPath)>/../share/starling/web` →
  source-tree path. The tarball already has the second path populated; the fix is one function in
  `apps/cli` (FIX REQUEST, Epic 203).
- **`starling --version` prints `0.0.0` in a release binary** until `program.version()` reads
  `process.env.STARLING_VERSION`. The value is baked in correctly today.
- **macOS tarballs are not bit-reproducible** (bsdtar has no deterministic flags). Linux ones are.
- **No signing, notarisation or `shasum` GPG signing.** macOS Gatekeeper will warn on first run.
- **No publishing automation, GitHub Release, Homebrew tap or Docker** — all later epics. The
  manual `gh release create` is documented in `tools/release/README.md` and never executed here.
- **No Windows target and no linux-arm64.** The installer treats both as unsupported.
- **Cross-target builds need network** (Bun downloads the runtime); only `--target all` does this,
  never the tests or the dry run.
- **`tools/release` is not typechecked by root `bun run check`** because root `typecheck` loops
  `packages/*` and `apps/*` only. It has its own `tsconfig.json` and passes
  `bunx tsc --noEmit -p tools/release`; adding `tools/*` to the root loop is a root-config change
  (FIX REQUEST for the integrator / Epic 203).
- **No CI job yet.** A release workflow should call `build.ts --target all` once per tag, not per
  platform, on a runner whose tar is GNU tar so Linux artefacts stay reproducible.
