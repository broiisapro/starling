# Epic 22 — CLI

## Goal

Make `starling` feel like a finished tool before the flock exists: every locked command from
ARCHITECTURE §6, a real live view, a real `replay`, a real `doctor` and a real `init` — all built
against the §8 handshake and a **composition root** so Wave 2 (Epic 40) can swap mocks for the real
engine, flock and store without touching a command.

The CLI is the first thing judges see, so the bar was: no placeholder strings, real tables, real
colour, real timing, a summary you would screenshot.

## How it works

```
argv ──► src/program.ts (commander) ──► src/commands/*.ts
                                              │
                                              ├─ src/context.ts   io · palette · config · clock · exec
                                              │
                                              └─ src/compose.ts   { engine, flock?, store, bus }
                                                       │
                                       ┌───────────────┴────────────────┐
                                 MockEngine (MemoryStore + EventBus)   MockFlockHub (MockRegistry)
                                 publishes the real §6 event stream    hub + MacBook Air perch
```

### Commands

| command          | Wave 1 behaviour                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan "<goal>"`  | dry-runs the mock engine, then renders the plan, its lanes, an all-pairs lane matrix and local plan issues. `--json` prints `{ plan, issues }`.                                                   |
| `run "<goal>"`   | subscribes to the bus **before** `start()`, live-renders, records events with `--record`, ends with a summary box and the dashboard URL unless `--no-dash`; `--dry-run` renders the plan instead. |
| `replay <file>`  | **real**: zod-validates every JSONL line, then plays the events through the same reducer and live view with `--speed` timing. Works on `fixtures/runs/sky-todo-launch-day.jsonl` today.           |
| `dash`           | prints the URL, health path and the two dev commands; the server itself is Wave 2.                                                                                                                |
| `perch`          | parses the join flags, registers a node in the mock FlockHub and prints the handshake.                                                                                                            |
| `flock`          | renders the roster and the join command; `--json` for scripts.                                                                                                                                    |
| `status [runId]` | renders a run from the live store, or from a recording with the additive `--file <path>`; `--json`.                                                                                               |
| `doctor`         | **real**: bun, git ≥ 2.38, opencode + version, a DeepSeek V4.1 Flash id in `opencode models`, `gh auth`, optional Ollama, config validity, free RAM. Exits 1 on any ✘.                            |
| `init`           | **real**: writes a commented `starling.config.yaml`, auto-detecting `opencode-go` → `deepseek` key → `local`; refuses to overwrite without `--force`.                                             |

Every command has an `Examples:` block in `--help`, and the root help explains the mock/Wave 2
status so nobody thinks a mock run hit a real repo.

### The composition root

`compose(config, { mode, stepMs?, now?, sleep? })` returns `{ engine, flock?, store, bus }`.

- `mode: 'mock'` builds `MockEngine` from `MemoryStore` + `createEventBus()` and `MockFlockHub` from
  `MockRegistry`/`MockNode`. It is a scripted five-task DAG (`survey → core-change → tests|docs →
  polish`) with one deliberate audit failure on `tests`, a fixer pass, a green attempt 2, and work
  spread across `hub` and `m2-air`. It publishes the exact §6 event stream, so the renderers,
  recorder, reducer and replay path are all exercised against realistic input.
- `mode: 'real'` throws `StarlingError('NOT_WIRED', 'real wiring lands in epic 40')`. The code is a
  local cast because `StarlingErrorCode` has no `NOT_WIRED`; see the contract request in the
  handback.

### Renderers

All renderers live in `src/render/`, are pure `(state) => string`, and take a `Palette` + width so
they can be snapshot-tested with colour on and off.

- `renderPlan(plan, issues, opts)` — task table (deps, owns globs, estimate), ✔/✘ health row, full
  pairwise lane matrix using `globsOverlap`, locked decisions, issues.
- `renderLive(state, opts)` — compact frame: run id/status/elapsed, goal, plan, flock, one row per
  task (status icon + word, key, node, attempts, elapsed, last agent action), footer with
  merged/failed/active/queue, a progress bar and `api $ / local $0 / saved $`, plus the last log line.
- `renderStatus(run, opts)` — header, progress, per-task verdicts, token/cost meter, constraints.
- `renderFlock(nodes, join, opts)` — roster and join command.
- `renderSummary(run, summary, opts)` — the closing box.
- `renderDoctor(result, opts)` — ✔/✘/! report with hints under non-ok checks.

`LiveView` (not pure) owns the terminal: TTY mode hides the cursor, redraws with cursor-up and
`\x1b[2K` line clears, and restores the cursor on `close()`; non-TTY mode writes plain frames with
no escape codes. Redraws are throttled by wall clock to one per 250 ms (≤ 4/s), with an explicit
`force` for the final frame.

### Live data flow

`src/live-state.ts` is a reducer over `StarlingEvent` shared by `run` and `replay`:

- `run.created` → run; `plan.created` → plan + issues + status `planned`;
- `task.status` → task snapshot + heuristic run status `running`;
- `agent.event` → `describeAgentEvent()` (text/tool/file/usage/idle/error) becomes the last action;
- `audit.verdict`, `merge.result`, `metrics`, `node.*`, `task.migrated`, `log` update their slices;
- `run.finished` → final run + summary.

Replay feeds the **same** reducer, with `state.now` taken from the recording's timestamps, so elapsed
times are those of the original run rather than the compressed wall clock.

### Recording and replay

- `--record out.jsonl` appends every event synchronously (parent directories created), with no store
  dependency. Appending is deliberate: the flag works mid-run and survives Ctrl-C.
- `readEventsJsonl` skips blank lines, validates with `StarlingEventSchema`, and reports
  `file:line: reason` for a bad line.
- Replay clamps each gap to 10 s so a corrupt timestamp cannot hang a terminal.

### `doctor` and `init` are real

Both receive an injectable `exec` (`DoctorExec`), `env`, `cwd`, memory probes and `fetch`, so every
branch is unit-tested with no network and no real processes:

- `doctor` distinguishes a required failure (✘, exit 1) from an optional warning (`ollama` missing,
  low free RAM). RAM thresholds are 2 GB (warn) and never fail: macOS reports “free” memory
  conservatively and 20 parallel agents should not make `doctor` unusable.
- `init` detects the profile with `opencode models` for `opencode-go/…deepseek…flash`; if that fails,
  `DEEPSEEK_API_KEY`; else `local`. Scalar fields come from `defaultConfig`, so the generated YAML
  cannot drift from the zod schema. The file is verified by parsing it with `loadConfig` in tests.

## Key decisions & reasoning

1. **The composition root is the only place that knows about mock vs real.** Commands import types
   from `src/handshake.ts` and call `context.composition()`. Epic 40 changes `compose.ts`; no command
   changes.
2. **Mock engine publishes real events, not a fake UI model.** This is what makes `replay`, the
   recorder, the reducer and every renderer real Wave 1 deliverables rather than Wave 2 scaffolding.
   It is scripted on purpose (one retry, fixed nodes); rebuilding the scheduler here would duplicate
   Epic 20 and drift.
3. **A local plan validator.** `packages/planner` is a sibling under construction, so
   `src/plan-health.ts` re-checks cycles, missing deps, empty DoD/lane, duplicate keys and
   lane overlaps using core's conservative `globsOverlap`. It powers the plan UI and `status --file`
   without importing a Wave 1 package. The engine's validator remains the gate.
4. **Colour is data.** Renderers take a `Palette`; `createPalette` enables colour only for a TTY
   (and `NO_COLOR`/`FORCE_COLOR`), while `plainPalette()`/`fixedPalette()` make snapshots stable and
   non-TTY pipes escape-free.
5. **Throttle by wall clock, not event time.** A recording compressed 200× should not emit 200
   frames/s. The final frame is always forced, so the last screen is correct even when the replay is
   faster than 250 ms in total.
6. **`status --file` is additive.** The in-memory store cannot see another process's run in Wave 1;
   rather than fake persistence, `status` can render a JSONL recording through the same reducer. It
   makes the command genuinely useful today and will be harmless once the SQLite store lands.
7. **`--no-dash` prints the URL, it does not launch a browser.** The locked surface says “skips
   opening the browser”; in Wave 1 there is nothing to open, so the default prints the URL and
   explicitly says the web app is Wave 2. Auto-opening a dead URL would be worse than a hint.
8. **`NOT_WIRED` cast.** The prompt specified `StarlingError('NOT_WIRED', …)`; the frozen union has
   `NOT_IMPLEMENTED` only. A local cast keeps the message honest and avoids editing `core`. Filed as
   a contract request.
9. **`init` writes a hand-written, commented template from `defaultConfig`.** A YAML serializer would
   produce an unreadable dump. The test parses the output with `loadConfig`, so the template is
   checked against the schema on every run.
10. **No timers, servers or browser processes are left behind.** `dash`/`perch` print and exit; the
    live view only uses the injected clock; `LiveView.close()` restores the cursor.

## Interfaces for future epics

Import from the package root (`@starling/cli`). The handshake types are re-exported type-only.

```ts
// composition root (src/compose.ts)
export interface ComposeOptions {
  mode: 'mock' | 'real';
  stepMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
export interface Composition {
  engine: EngineApi;
  flock?: FlockHub;
  store: Store;
  bus: EventBus;
}
export function compose(config: StarlingConfig, options: ComposeOptions): Composition;

// commander surface (src/program.ts)
export interface CreateProgramOptions {
  deps?: CliDeps;
  dispatch?: (command: string, args: unknown[], options: Record<string, unknown>) => Promise<number>;
  onExitCode?: (code: number) => void;
}
export function createProgram(options?: CreateProgramOptions): Command;
export function main(argv?: string[], deps?: CliDeps): Promise<number>;

// command context (src/context.ts)
export interface CliIO {
  write(text: string): void;
  isTTY: boolean;
  columns: number;
}
export interface CliDeps {
  io?: Partial<CliIO>;
  execFn?: CliExec;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  cwd?: string;
  env?: Record<string, string | undefined>;
  config?: StarlingConfig;
  configPath?: string;
  mode?: 'mock' | 'real';
  mockStepMs?: number;
  color?: boolean;
  freeMemGb?: () => number;
  totalMemGb?: () => number;
  fetchFn?: typeof fetch;
}
export interface CliContext {
  deps: CliDeps;
  io: CliIO;
  palette: Palette;
  cwd: string;
  env: Record<string, string | undefined>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  execFn: CliExec;
  columns: number;
  loadStarlingConfig(): StarlingConfig;
  composition(): Composition;
  write(text?: string): void;
  writeErr(text: string): void;
  formatError(err: unknown): string;
}
export function createCliContext(deps?: CliDeps): CliContext;
export function runGuarded(context: CliContext, body: () => Promise<number>): Promise<number>;

// renderers (src/render/*)
export function renderPlan(plan: Plan, issues: PlanIssue[], options: RenderPlanOptions): string;
export function renderLive(state: LiveState, options: RenderLiveOptions): string;
export function renderStatus(run: Run, options: RenderStatusOptions): string;
export function renderFlock(
  nodes: NodeInfo[],
  join: JoinInfo | undefined,
  options: RenderFlockOptions,
): string;
export function renderSummary(run: Run, summary: string, options: RenderSummaryOptions): string;
export function renderDoctor(result: DoctorResult, options: RenderDoctorOptions): string;
export class LiveView {
  constructor(options: LiveViewOptions);
  render(state: LiveState, options?: { force?: boolean }): boolean;
  close(): void;
}

// doctor + init (src/doctor.ts, src/init.ts)
export async function runDoctor(deps: DoctorDeps): Promise<DoctorResult>;
export function hostIdentity(): { platform: string; arch: string };
export type ModelProfile = 'opencode' | 'deepseek' | 'local';
export async function initConfig(options: InitOptions): Promise<InitResult>;
export function detectModelProfile(options: {
  execFn: DoctorExec;
  env?: Record<string, string | undefined>;
  cwd: string;
}): Promise<ModelProfile>;
export function renderConfigYaml(profile: ModelProfile): string;

// recordings (src/jsonl.ts)
export function parseEventsJsonl(text: string, source?: string): StarlingEvent[];
export function readEventsJsonl(path: string, cwd?: string): StarlingEvent[];
export function createEventRecorder(path: string, cwd?: string): EventRecorder;

// live state (src/live-state.ts)
export interface LiveState {
  /* run?, plan?, issues, nodes, lastActions, verdicts, merges, logs, now, finishedSummary?, eventCount */
}
export function emptyLiveState(): LiveState;
export function applyEvent(state: LiveState, event: StarlingEvent): LiveState;
export function stateFromEvents(events: StarlingEvent[]): LiveState;
export function describeAgentEvent(event: AgentEvent): string;

// Wave 1 handshake mirror (src/handshake.ts) — moved into core at checkpoint C1.
// The package root re-exports it type-only, so consumers write:
//   import type { EngineApi, FlockHub, JoinInfo } from '@starling/cli';
export type * from './handshake';
```

Usage from another package or an embedding test:

```ts
import { compose, createCliContext, renderPlan } from '@starling/cli';
import { defaultConfig } from '@starling/core';

const { engine, bus } = compose(defaultConfig, { mode: 'mock', stepMs: 0 });
bus.subscribe((event) => console.log(event.type));
const { runId } = await engine.start({ goal: 'add dark mode', repoPath: '/tmp/sky-todo' });
const run = await engine.waitForFinish(runId);
const context = createCliContext({ color: false, io: { write: console.log } });
console.log(renderPlan(run.plan!, [], { palette: context.palette, goal: run.goal.text }));
```

Epic 40 replaces the body of `compose('real')` with the real `Engine` from `@starling/engine` and the
real `FlockHub` from `@starling/flock`. The CLI surface, renderers and tests stay as they are.

## Definition-of-done evidence

### `bun run test` (root)

```
$ bun test packages apps skills integrations tools evals
 286 pass
 0 fail
 10 snapshots, 1137 expect() calls
Ran 286 tests across 51 files. [268.00ms]
```

`bun test apps/cli` alone: **103 pass, 0 fail**, 10 snapshots, 359 `expect()` calls across 15 files.

### `bun run starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 200` (final screen)

```
Starling  ·  9w0x1y  ·  finished  ·  5:56
goal  Add dark mode with a toggle, live search filtering, CSV export, keyboard shortcuts (n = new, …
plan  7 tasks · 2 dep edges · deepseek-v4.1-flash
flock 2 nodes · 2 online · 13 free session slots

STATUS    TASK          NODE  ATT  TIME  LAST ACTION
✔ merged  theme         hub     1  1:22  → merged
✔ merged  search        hub     1  1:08  → merged
✔ merged  csv-export    hub     0  0:43  → merged
✔ merged  shortcuts     hub     0  0:50  → merged
✔ merged  due-badges    air     0  0:56  → merged
✔ merged  dates-fix     hub     0  0:33  → merged
✔ merged  help-overlay  air     0  1:09  → merged

✔ 7 merged  ·  ✘ 0 failed  ·  ◐ 0 active  ·  queue 0
  ██████████████ 100%  7 merges   api $0.031  ·  local $0  ·  saved $0.014
  All 7 tasks merged; writing the run summary

╭────────────────────────────────────────────────────────────────────────────────────────╮
│ ✔ run finished in 5:56                                                                 │
│ ✔ 7 merged  ·  ✘ 0 failed  ·  0 conflicts                                              │
│ api $0.031  ·  local $0  ·  saved $0.014                                               │
│ branch starling/9w0x1y/integration                                                     │
│                                                                                        │
│ Seven tasks merged into starling/9w0x1y/integration in 5m 56s. One audit failure on    │
│ theme was fixed on attempt 2; the Air joined, took three tasks, dropped, and its       │
│ search task migrated back to the hub without losing the branch. API spend $0.031,      │
│ local audits saved an estimated $0.014.                                                │
╰────────────────────────────────────────────────────────────────────────────────────────╯

replayed 252 events from fixtures/runs/sky-todo-launch-day.jsonl · ×200 · 2.0s wall time · run 9w0x1y finished
```

### `bun run starling doctor`

```
$ bun apps/cli/src/index.ts doctor
Starling doctor  ·  darwin/arm64 · bun 1.4.4

✔ bun       1.4.4 (needs ≥ 1.3)
✔ git       2.54.0 (needs ≥ 2.38)
✔ opencode  opencode v2.1.2
✔ deepseek  opencode-go/deepseek-v4.1-flash (any provider is fine)
✔ gh        authenticated
✔ config    defaults (no starling.config.yaml yet — run `starling init`)
! ollama    not reachable at http://127.0.0.1:11434/api/tags (optional — only needed for local role…
            hint: ollama serve
✔ ram       2.1 GB free of 32 GB

✔ 7 ok  ·  ✘ 0 failed  ·  ! 1 warning
Ready to fly. 🐦  Try `starling plan "<goal>"`.
```

## Deviations from plan

- **`status --file <path>`** and **`init --profile <profile>`** are additive flags. `status` needs a
  way to show a run from another process before the SQLite store exists; `init` needs a deterministic
  profile for tests and for users who do not want auto-detection. Neither changes a locked flag.
- **`flock --json` and `status --json`** are additive (the assignment only required `--json` for
  `plan`, `status` and `flock`; `status` was in the “where it makes sense” set).
- **`run` does not open a browser.** Default prints the URL and a “web app lands in Wave 2” note;
  `--no-dash` suppresses it. See decision 7.
- **Mock plan is generic** (survey/core/tests/docs/polish), not the sky-todo fixture. The fixture is
  used by `replay`; `run` must accept an arbitrary goal without pretending to have read the repo.
- **`doctor` and `init` call `opencode models` with a 15 s timeout.** A cold opencode service can take
  seconds to enumerate 100+ models; a shorter timeout made `init` fall back to `local` on this
  machine.
- **`bun run check` is red from pre-existing files outside this lane.** Biome 2.6.3 flags
  `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md` and six files under `tools/local-models/`
  (nine errors total); none are touched by this branch (see `git status`). `bunx biome check apps/cli`
  is clean and `bun run typecheck` exits 0 for every workspace.
- **`NOT_WIRED` is cast** (see decision 8 and the handback contract request).
- The opener “live redraw ≤ 4×/s” is implemented as a wall-clock throttle on `LiveView`, not a
  `setInterval`; no timer is left running after `close()`.

## Known limitations / deferred

- **No real engine/flock/store wiring.** `compose('real')` throws; the mock is in-memory and
  per-process. Epic 40 replaces `compose.ts`.
- **`dash` does not start a server and `perch` does not bind a port.** Both are UX/flag/join
  handshakes in Wave 1; Epic 19/21 own the daemons.
- **`run` has no Ctrl-C handler** (the mock run is ~2 s). A real engine will need `engine.cancel()`
  wiring on SIGINT; `EngineApi.cancel` already exists.
- **Status is per-process** unless `--file` is used. The SQLite store (Epic 15) removes that caveat.
- **The mock engine is scripted**: one retry on `tests`, no conflicts, no node loss. The fixture run
  exercises those paths; the engine itself does not.
- **Plan validation is deliberately conservative** and duplicates a small part of the planner’s job
  for display. Once Epic 07 lands, the CLI can prefer the planner’s issues when available.
- **`--github` and `--fully-open` are parsed and acknowledged**, not acted on. Both are Wave 2
  features (Epic 40 / Epic 10).
