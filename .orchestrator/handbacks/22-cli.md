## Epic 22 Handback — CLI

**Status:** Complete. Branch `epic/22-cli` @ `00f4207` (code tip `27d0919`; this handback and the epic doc are the last two commits).
**Delivered:**
- All nine locked commands with help text, examples and the exact §6 flags: `plan`, `run`, `replay`, `dash`, `perch`, `flock`, `status`, `doctor`, `init`. `plan`/`status`/`flock` have `--json`; `status` adds `--file <path>` and `init` adds `--profile <auto|opencode|deepseek|local>`.
- `src/compose.ts` — the composition root: `compose(config, { mode, stepMs?, now?, sleep? }) → { engine, flock?, store, bus }`. `mock` builds `MockEngine` (`MemoryStore` + `createEventBus`) and `MockFlockHub` (`MockRegistry`/`MockNode`, hub + MacBook Air). `real` throws `StarlingError('NOT_WIRED', 'real wiring lands in epic 40')`.
- `src/handshake.ts` — ARCHITECTURE §8 mirrored verbatim with the required `MIRROR of ARCHITECTURE §8...` header; no sibling Wave 1 package is imported anywhere.
- `MockEngine` publishing the full real event stream (`run.created`, `repomap.ready`, `plan.created`, `task.status`, `agent.event`, `audit.verdict`, `merge.result`, `metrics`, `node.joined`, `run.finished`) for a five-task DAG with one audit failure → fixer → pass on attempt 2, work spread over `hub` and `m2-air`.
- Pure renderers in `src/render/`: `renderPlan` (task table + all-pairs lane matrix + issues), `renderLive` (one row per task with icon/key/node/attempts/elapsed/last action; footer with merged/failed, progress bar, API $ / local $0 / saved $), `renderStatus`, `renderFlock`, `renderSummary`, `renderDoctor`. `LiveView` does ANSI cursor-up redraw and cursor hide/restore on a TTY, plain append-only frames when `!isTTY`, and a wall-clock throttle of ≤ 4 frames/s with a forced final frame.
- `starling run` subscribes before `start()`, drives `renderLive`, appends every event with `--record` (store-free, parent dirs created, sync writes), ends with the summary box, prints the dashboard URL unless `--no-dash`, and acknowledges `--github`/`--fully-open` as Wave 2. `--dry-run` renders the plan instead.
- `starling replay` is fully real: zod-validated JSONL, shared reducer, original timing scaled by `--speed` (clamped per step), works on `fixtures/runs/sky-todo-launch-day.jsonl` today. Bad line numbers are reported as `file:line: reason`.
- `starling doctor` is fully real and injectable: bun, git ≥ 2.38, opencode + version, a DeepSeek V4.1 Flash id in `opencode models`, `gh auth`, optional Ollama (warn), config validity, free RAM. Pretty ✔/✘/! with hints; exits 1 on any ✘.
- `starling init` is fully real: commented `starling.config.yaml` from `defaultConfig`, profile detection `opencode-go` → `DEEPSEEK_API_KEY` → `local`, overwrite guard with `--force`. Generated files are parsed with `loadConfig` in tests.
- `src/plan-health.ts` — local, conservative plan checks (cycle, missing dep, empty DoD/lane, duplicate key, concurrent lane overlap) so `plan` and `status --file` are useful without importing the Wave 1 planner.
- 103 CLI tests (commander parsing for every command/flag, TTY + non-TTY renderer snapshots, replay over the 252-event fixture at `--speed 1000`, doctor's all-green + every ✘ case, init content/guard/detection, mock `run`, recording round-trip, LiveView throttling).
- `docs/epic-22-cli.md` with the required sections, exact interfaces, usage snippet, full test/check evidence, pasted `replay --speed 200` final screen and `doctor` output.

**Key design decisions:**
- **Mock composition publishes the real event stream** — the renderers, recorder, reducer and replay are genuine Wave 1 deliverables; rebuilding the scheduler in the CLI would duplicate Epic 20.
- **The composition root is the only mock/real switch** — commands import §8 types and call `context.composition()`. Epic 40 edits `compose.ts` only.
- **Local plan validator** — `plan-health.ts` uses core's conservative `globsOverlap` to present cycles/lane conflicts without importing the parallel planner; the engine remains the gate.
- **Colour is injected** — renderers take a `Palette`, so TTY snapshots are coloured and non-TTY output is escape-free.
- **Wall-clock throttle for live output** — replay at 200× must not emit 200 frames/s; a forced final frame guarantees the last screen is correct.
- **`status --file` instead of fake persistence** — the Wave 1 store is in-memory; `--file` renders a recording through the same reducer and disappears in importance when Epic 15 lands.
- **`--no-dash` prints the URL, does not launch a browser** — auto-opening a dead Wave 1 URL would be worse; the default says the web app lands in Wave 2.
- **`doctor` never fails on low RAM** (warn only) and treats Ollama as optional — macOS “free” memory is conservative and the demo machine runs many agents.
- **`init` writes a hand-written template from `defaultConfig`** and the test parses it with `loadConfig`, so comments and schema cannot drift.
- **No lingering timers/servers** — `dash`/`perch` print and exit; `LiveView.close()` restores the cursor; the mock engine uses only injected sleep.

**Verification (exact commands + results):**
- `bun install`: `Checked 133 installs across 192 packages (no changes)`.
- `bun run test` (root): **286 pass / 0 fail** — summary line: `286 pass, 0 fail, 10 snapshots, 1137 expect() calls. Ran 286 tests across 51 files.`
- `bun test apps/cli`: **103 pass / 0 fail**, `10 snapshots, 359 expect() calls. Ran 103 tests across 15 files.`
- `bun run typecheck`: exit 0 for every workspace (the full `bun run check` loop was also run separately after Biome).
- `bunx biome check apps/cli`: `Checked 53 files … No fixes applied.`
- `bun run check`: **exit 1**, but only from files untouched by this branch. `git diff --stat origin/main -- docs/epic-01-demo-target.md docs/epic-02-repo-ops.md tools/local-models` is empty. Biome 2.6.3 reports: `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/{host.ts,ollama.test.ts,ollama.ts,smoke.ts}` and two `tools/local-models/results/*.json` (9 errors total, all pre-existing on `origin/main`). No error is in `apps/cli`.
- `bun run starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 200`: exit 0, final frame **7 merged · 0 failed · api $0.031 · local $0 · saved $0.014**, 252 events, final screen pasted in the epic doc.
- `bun run starling doctor`: exit 0 — 7 ok, 0 failed, 1 warning (Ollama not running), output pasted in the epic doc.
- `bun run starling run "add CSV export with escaping" --no-dash --record <tmp>/run.jsonl`: exit 0, 5 merged, 76 events recorded; re-running `starling replay <tmp>/run.jsonl --speed 200` reproduced the finished run.
- `bun run starling init` in a temp cwd detected `opencode-go` from this machine's `opencode models`; the generated file parses with `loadConfig` (also covered by `init.test.ts` for all three profiles).
- `bun run starling plan "..."`, `flock`, `perch` and `status --file` were manually run and are covered by command tests; `bun run starling --help` shows all commands and the mock/Wave 2 note.

**Dependencies added:** none. `commander@15.0.0` and `picocolors@1.1.1` were already in `apps/cli/package.json`; `bun.lock` is untouched.

**CONTRACT REQUESTS:**
- Add `'NOT_WIRED'` to the `StarlingErrorCode` union in `packages/core/src/errors.ts` (or bless `'NOT_IMPLEMENTED'` as the canonical code for “wired in a later epic”). ARCHITECTURE §6's assignment for Epic 22 specifies `StarlingError('NOT_WIRED', 'wired in epic 40')`, but the frozen union has no `NOT_WIRED`. The CLI currently uses a local `'NOT_WIRED' as StarlingErrorCode` cast in `compose.ts`; the message and behaviour are correct, but the code is outside the union until core adds it.

**Deliberately deferred / out of scope:**
- Real engine/flock/store wiring (`compose('real')`), the web dashboard/server, npm packaging — all Wave 2/3.
- A living `perch` daemon and `dash` server: Wave 1 only parses flags, registers a mock node and prints the handshake.
- Ctrl-C → `engine.cancel()` wiring in `run` (the mock run is ~2 s); `EngineApi.cancel` is implemented and tested.
- SQLite persistence for `status` across processes (Epic 15); `--file` is the Wave 1 bridge.
- `--github` / `--fully-open` behaviour; parsed and acknowledged only.
- Resolver/conflict UI; `renderStatus` already shows conflicts, but the mock engine never produces one.

**Open questions / flagged tradeoffs:**
- **`bun run check` is red on `origin/main`** in `docs/epic-01`, `docs/epic-02` and `tools/local-models/` (Biome formatting). Fixing them is outside this lane; the integrator may want a separate formatting pass (or to exclude `tools/local-models/results/` JSON from Biome).
- `doctor` uses a 15 s timeout for `opencode models`; on a cold opencode service, a shorter timeout made `init` fall back to `local` on this machine.
- The mock plan is generic (survey/core-change/tests/docs/polish), not the sky-todo plan; `run` must accept arbitrary goals, and the fixture remains the replay showcase.
- `status` picks the most recent run only, with no `--all` list yet; trivial to add when the store can list across processes.
- `replay` exits 1 if the recording ends mid-run (status not `finished`); that is intentional so scripts can detect a truncated recording.

Closes #16
