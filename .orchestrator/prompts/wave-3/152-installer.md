# Epic 152: Install script: `curl | sh` with checksum verification

**Wave 3 · Branch `epic/152-installer` · Issue: `gh issue list --search "Epic 152 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-152-installer.md` and `.orchestrator/handbacks/152-installer.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Shared contract with Epic 151 (packaging), running in parallel.** Asset `starling-<version>-<os>-<arch>.tar.gz` (`os` ∈ `darwin|linux`, `arch` ∈ `arm64|x64`; version without `v`), top-level dir `starling-<version>-<os>-<arch>/` containing `bin/starling` and `share/starling/web/`, checksums in `SHA256SUMS` as `<64 hex>  <asset name>`, release URLs `https://github.com/broiisapro/starling/releases/download/v<version>/<asset>` and `…/releases/latest/download/<asset>`. Code against this; don't import from `tools/release`.
- The tests spawn `sh` against `127.0.0.1` only. No real network: the default base URL must never be hit in tests (assert the env override is set in every test).

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`tools/install/**`
plus `docs/epic-152-installer.md` and `.orchestrator/handbacks/152-installer.md`. Read anything.

## Goal
The README's quickstart should be one line: `curl -fsSL https://…/install.sh | sh`. This epic writes that installer and its uninstaller as careful POSIX `sh`: detect OS/arch, download the right release tarball, verify its SHA-256 against `SHA256SUMS`, install into `~/.starling`, and print a PATH hint for the user's shell. It's tested end to end against a local fake release server, so it's trustworthy without ever touching GitHub. Great looks like: it refuses to install anything that fails the checksum, it's idempotent, it explains every failure in one friendly line, and `sh -n` / `dash` are happy.

## Deliverables
1. `tools/install/install.sh` (POSIX `sh`, `set -eu`, no bashisms; runs under `dash` and macOS `/bin/sh`): detect `uname -s` → `darwin|linux` and `uname -m` → `arm64|x64` (`aarch64`→`arm64`, `x86_64`/`amd64`→`x64`); unsupported combos (e.g. linux-arm64, which Epic 151 doesn't build) exit 1 naming the supported list and the "build from source" link. Overrides for tests and power users: `STARLING_VERSION` (default `latest`), `STARLING_INSTALL_DIR` (default `$HOME/.starling`), `STARLING_RELEASE_BASE_URL` (default `https://github.com/broiisapro/starling/releases`), `STARLING_UNAME_S` / `STARLING_UNAME_M` (fake platform), `STARLING_NO_MODIFY_PATH=1`.
2. Download: `curl -fsSL` or `wget -qO-` (whichever exists; neither → exit 1 with a hint), `latest` → `<base>/latest/download/<asset>`, else `<base>/download/v<version>/<asset>`, plus `SHA256SUMS` from the same place. Asset naming and archive layout are **Epic 151's contract** (see extra rules). Everything goes to a `mktemp -d` dir removed by a `trap` on exit.
3. Verify: compute SHA-256 with `sha256sum` or `shasum -a 256`, compare with the `SHA256SUMS` line for the asset; missing line or mismatch → exit 1, **nothing installed**, temp dir removed. No checksum tool → refuse (unless `STARLING_INSECURE_SKIP_VERIFY=1`, which prints a loud warning).
4. Install: extract, check `bin/starling` exists and is executable, then atomically replace `$INSTALL_DIR/bin/starling` (write `starling.new` then `mv`) and `$INSTALL_DIR/share/starling/web/` (replace the directory), write `$INSTALL_DIR/VERSION`. Re-running with the same version is a no-op with a friendly note; a different version upgrades. Never use `sudo`; never write outside `$INSTALL_DIR` except the optional rc-file line.
5. PATH: if `$INSTALL_DIR/bin` isn't on `PATH`, detect the shell from `$SHELL` and print the exact line for `~/.zshrc`, `~/.bashrc`/`~/.bash_profile`, or `~/.config/fish/config.fish` (`fish_add_path`). Only with `--modify-path` (flag) append it, once (grep for an existing marker comment `# added by starling installer`). Then run `"$INSTALL_DIR/bin/starling" --version` and print a success line with a bird, and the next commands (`starling try`, `starling doctor`).
6. `tools/install/uninstall.sh` (POSIX `sh`): removes `$INSTALL_DIR/bin/starling`, `$INSTALL_DIR/share/starling`, `$INSTALL_DIR/VERSION`, and the marker line from rc files (only lines with the marker), keeps `$INSTALL_DIR/perch` and any user data unless `--purge`; prints what it removed; safe to run twice.
7. Flags for both scripts: `--help`, `--version <v>` (install only), `--dir <path>`, `--quiet`. Unknown flag → exit 2 with usage.
8. `tools/install/fake-release.ts`: `startFakeRelease({ version, platforms, corrupt? }): Promise<{ baseUrl, stop() }>` serving `latest/download/*` and `download/v<version>/*` from `Bun.serve` on `127.0.0.1:0`, with generated tarballs that match 151's layout (a tiny shell-script `bin/starling` printing `starling <version>`, a `share/starling/web/index.html`) and a correct (or deliberately corrupted) `SHA256SUMS`.
9. `tools/install/install.test.ts` (≥ 20 tests), each with a temp `HOME` and `STARLING_INSTALL_DIR`, running the real script via `sh` (and `dash` when installed, `test.skipIf` otherwise): happy path for each faked platform; checksum mismatch installs nothing; missing `SHA256SUMS` line; unsupported platform; `latest` vs pinned version URLs; idempotent re-run; upgrade; PATH hint per shell; `--modify-path` writes the marker once; uninstall removes exactly what install wrote and keeps `perch/`; `--purge`; `sh -n` on both scripts; a grep-based lint that the scripts contain no `[[`, `function `, `local `, `source ` or `$'…'` (bashisms).
10. `tools/install/README.md`: the one-liner, what it does step by step, env overrides, uninstall, and how to test locally.

## Explicitly out of scope
- Building release assets (Epic 151) or publishing them. Windows/PowerShell.
- Hosting the script at a pretty URL (document the raw GitHub URL; the README epic 172 links it).
- Installing Bun, opencode or git (print hints only; `starling doctor` checks them).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `bun test tools/install` → 0 fail, ≥ 20 tests; `bunx tsc --noEmit -p tools/install` clean (add a `tsconfig.json` like `tools/load`'s).
3. `sh -n tools/install/install.sh && sh -n tools/install/uninstall.sh` clean (and `dash -n` if available).
4. Manual run against the fake server: start it with a tiny script (`bun -e` importing `startFakeRelease`), then `STARLING_RELEASE_BASE_URL=<url> STARLING_INSTALL_DIR=/tmp/st-home/.starling sh tools/install/install.sh`; paste the output, `ls -R /tmp/st-home/.starling | head`, then the uninstall output.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-152-installer.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/152-installer.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/152-installer`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
