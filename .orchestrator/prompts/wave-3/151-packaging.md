# Epic 151: Packaging: single-file binaries, checksums, Homebrew template

**Wave 3 · Branch `epic/151-packaging` · Issue: `gh issue list --search "Epic 151 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-151-packaging.md` and `.orchestrator/handbacks/151-packaging.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Shared contract with Epic 152 (installer), running in parallel.** Asset name `starling-<version>-<os>-<arch>.tar.gz` (`os` ∈ `darwin|linux`, `arch` ∈ `arm64|x64`), top-level dir `starling-<version>-<os>-<arch>/` with `bin/starling` and `share/starling/web/`, checksums in `SHA256SUMS` as `<hex>  <name>`, release URL `https://github.com/broiisapro/starling/releases/download/v<version>/<asset>`. Don't change any of it; if you must, say so loudly in the handback.
- Run real compiles only through the slot gate (`bash .orchestrator/bin/heavy.sh …`): each one takes seconds of full CPU and ~110 MB of disk. Delete temp outputs when done.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`tools/release/**`
plus `docs/epic-151-packaging.md` and `.orchestrator/handbacks/151-packaging.md`. Read anything.

## Goal
Judges and Hacktoberfest contributors shouldn't need Bun to try Starling. This epic makes release artefacts reproducible from one script: `bun build --compile` binaries for darwin-arm64, darwin-x64 and linux-x64, each in a tarball with the built dashboard alongside, a `SHA256SUMS` file, a Homebrew formula rendered from a template, and a dry-run that builds the host target and smoke-tests the binary. Nothing is published. Great looks like: `bun tools/release/dry-run.ts` ends with a green checklist, and the asset names exactly match what the installer (Epic 152) downloads.

## Deliverables
1. `tools/release/targets.ts`: `TARGETS = [{ os: 'darwin', arch: 'arm64', bunTarget: 'bun-darwin-arm64' }, { os: 'darwin', arch: 'x64', bunTarget: 'bun-darwin-x64' }, { os: 'linux', arch: 'x64', bunTarget: 'bun-linux-x64' }] as const`, `hostTarget()`, and `assetName(version, target)` → `starling-<version>-<os>-<arch>.tar.gz` (version without a leading `v`). **This naming is a contract shared with Epic 152** (installer, in parallel): copy it verbatim into your doc's "Interfaces" section.
2. Archive layout (also shared with 152): top-level dir `starling-<version>-<os>-<arch>/` containing `bin/starling`, `share/starling/web/**` (a copy of `apps/web/dist`), `LICENSE`, `README.md`. `SHA256SUMS` lines are `<64 hex>  <asset name>` (two spaces, sorted by name), matching `shasum -a 256` / `sha256sum` output.
3. `tools/release/build.ts`: `buildRelease({ version, targets, outDir, webDist, exec, skipWebBuild }): Promise<ReleaseManifest>`: builds the web app once (`bun run --cwd apps/web build`) unless `--skip-web`, then per target `bun build --compile --minify --sourcemap=none --target=<bunTarget> apps/cli/src/index.ts --outfile <staging>/bin/starling` (the CLI entry compiles today: ~110 MB on linux-x64), copies the web dist and docs, creates the tarball with `tar -czf` (deterministic flags where the platform tar supports them: `--sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner` on GNU tar, plain on bsdtar; detect, don't assume), and writes `SHA256SUMS` plus `manifest.json` (`{ version, commit, builtAt, assets: [{ name, os, arch, bytes, sha256 }] }`). CLI: `bun tools/release/build.ts --version 0.1.0 [--target host|all|<os>-<arch>] [--out tools/release/dist] [--skip-web]`. Output under `tools/release/dist/` (ignored by the root `.gitignore`'s `dist/`).
4. Cross-compiling non-host targets makes Bun download that target's runtime (network). That's fine for a manual `--target all` run, but **tests and the dry run only build the host target**.
5. Version: read `--version`, else the root `package.json` version, and pass it into the binary with `--define process.env.STARLING_VERSION='"<v>"'` (Epic 145's `starling version` reads it; Epic 203 can make `program.version()` use it: FIX REQUEST).
6. `tools/release/homebrew/starling.rb.tmpl` + `renderFormula({ version, assets, repo })`: a formula with `on_macos`/`on_linux` + `on_arm`/`on_intel` blocks pointing at `https://github.com/broiisapro/starling/releases/download/v<version>/<asset>` with the right `sha256`, `bin.install "bin/starling"`, `pkgshare.install "share/starling/web"`, and a `test do` block running `starling --version`. Rendered into `dist/starling.rb`.
7. `tools/release/dry-run.ts`: builds the host target into a temp dir, verifies the checksum file against the tarball, extracts it to another temp dir, runs `bin/starling --version`, `bin/starling --help`, and `bin/starling replay <repo>/fixtures/runs/sky-todo-launch-day.jsonl --speed 1000` (must exit 0), checks `share/starling/web/index.html` exists, renders the formula, and prints a ✓/✗ checklist with sizes. Exit non-zero on any ✗.
8. **Known gap to report, not fix:** the compiled binary can't find the dashboard today because `apps/cli` resolves `apps/web/dist` from `import.meta.dir` (Epic 40's `real/dashboard.ts` `resolveWebDist`), which points into Bun's virtual FS in a compiled binary. Write a FIX REQUEST for Epic 203: honour `STARLING_WEB_DIST`, then `<dirname(process.execPath)>/../share/starling/web`, before the source-tree path. Your dry run should check the layout is right so that fix just works.
9. `tools/release/README.md`: how to cut a release by hand (build all, check, upload with `gh release create` — documented, never executed by scripts), and the asset contract.
10. Tests (≥ 25) with an injected `exec` (no real compile in unit tests): target matrix and names, host detection, the build command line per target, tar flag detection for GNU vs bsd, checksum formatting and verification (real hashing of small temp files with `node:crypto`), manifest shape, formula rendering snapshot (both arches, sha256 inserted), version resolution order, `--target` parsing errors. One `*.slow.test.ts`-style test that really compiles the host binary is **not** allowed in the default suite (too heavy with 100 agents); the dry run covers it.

## Explicitly out of scope
- Publishing anything (GitHub releases, Homebrew tap, npm). No signing or notarisation (document it as a limitation).
- The install script (Epic 152), CI release workflow (later), Docker (Epic 153).
- Changing `apps/cli` to embed or locate the web dist (FIX REQUEST, item 8).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test tools/release` → 0 fail, ≥ 25 tests; `bunx tsc --noEmit -p tools/release` clean (add `tools/release/tsconfig.json` like `tools/load`'s).
3. `bash .orchestrator/bin/heavy.sh bun tools/release/dry-run.ts` → all ✓. Paste the checklist, the tarball size and the `SHA256SUMS` line.
4. `bun tools/release/build.ts --version 0.1.0 --target host --skip-web` (after one web build) produces `tools/release/dist/` with the asset, `SHA256SUMS`, `manifest.json` and `starling.rb`; `git status` shows none of them as untracked.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-151-packaging.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/151-packaging.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/151-packaging`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
