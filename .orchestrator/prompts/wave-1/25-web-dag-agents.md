# Epic 25: Web: DAG + agent drawer

**Wave 1 · Branch `epic/25-web-dag-agents` · Issue: find it with `gh issue list --search "Epic 25 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees (on this laptop and on other laptops, "perches"), audits each result with tests, a lane check and a local model, and merges everything through a queue, all shown live in a murmuration dashboard.

**Wave 0 is merged** (tags `epic-00-complete`, `epic-01-complete`):
- `@starling/core`: every contract (zod-first), every port, the event bus, config, `exec`, globs (`matchesAny`, `globsOverlap`, `lanesDisjoint`), pricing/metrics, and **`@starling/core/testing`**, which has a mock for every port plus factories (`makePlan`, `makeRun`, `makeTaskSpec`, `makeNodeInfo`, `makeAgentEvent`, …). **Read `docs/epic-00-foundation.md` first.** Its "Interfaces for future epics" section lists every exported symbol.
- `fixtures/`: `repomaps/sky-todo.json`, `plans/sky-todo-launch-day.json`, `runs/sky-todo-launch-day.jsonl` (252 realistic events including flock events).
- `examples/sky-todo/`: the demo app Starling will operate on. `examples/scripts/make-demo-repo.sh` makes a fresh git repo of it.

**You are one of 23 agents building Wave 1 at the same time**, each in its own lane. Your siblings' packages are still placeholders while you work. **Never import a sibling Wave 1 package.** Depend only on `@starling/core` and its mocks. Where you meet a sibling, use the **handshake interfaces in ARCHITECTURE §8**, mirrored locally in `src/handshake.ts`, copied verbatim with the header comment the section specifies.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**. Especially:
- **L21**: Bun 1.4.4, TS 5.9.3, zod 4.6.7, Biome 2.6.3; never touch root config.
- **L22**: add deps only to your own package.json, pinned exact.
- **L23**: **NO local models, no real LLM calls, no real opencode prompts, no GitHub calls from tests, no `ollama` commands at all.** Use the core mocks and in-process `Bun.serve({ port: 0 })` fakes. You may write `*.live.test.ts` files but do not run them. This laptop runs 20+ agents at once, so keep memory use low: no long-running servers left behind, no huge test fixtures.
- **L13/L14**: git and gh go through `exec` from core, injectable so tests can fake it.

## FIRST TASK: carryover
None. This is a Wave 1 epic built directly on Wave 0. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write ONLY here)
`apps/web/src/features/dag/**` and `apps/web/src/features/agents/**` (may add a dependency line to `apps/web/package.json`, add-only).
plus `docs/epic-25-web-dag-agents.md` and `.orchestrator/handbacks/25-web-dag-agents.md`. Read anything; write nothing else.

## Goal
Build the two "zoom in" panels: the **task DAG** (what depends on what, and who's where, coloured by status, with lanes on hover), and the **agent drawer** (everything about one task: its live activity stream, audit verdicts, diff and spec). Props-only components per ARCHITECTURE §8.

## Deliverables
- `export function DagView(props: DagViewProps)` from `features/dag/index.ts`:
  - `@xyflow/react` plus `@dagrejs/dagre` (pre-installed). Layout left→right, memoised by plan id.
  - Each node card shows status (colour + icon), key, short title, node badge (hub/perch name), attempts, elapsed.
  - Edges animate while the downstream task is waiting on an upstream that's running.
  - Hovering shows the lane `owns` globs in a tooltip. Clicking calls `onSelectTask`. Selection is highlighted.
  - Fit-to-view on plan change, a minimap toggle, and keyboard navigation between nodes.
- `export function AgentDrawer(props: AgentDrawerProps)` from `features/agents/index.ts`, a right-side drawer with tabs:
  - **Activity**: the `AgentEvent` stream rendered as a readable timeline. Text as prose (markdown-lite: code spans, fenced code); tool calls as collapsible rows (tool name + one-line summary + ok/err); file edits as chips; usage as subtle footers. Auto-scrolls when at the bottom, with a "jump to latest" pill otherwise. Virtualised for 500 events.
  - **Audit**: one card per `AuditVerdict` attempt (newest first): a pass/fail banner, the checks table (name, ok, detail, duration), lane violations, and fix instructions as a numbered list.
  - **Diff**: a file list with +/− counts and a unified patch viewer with per-line add/remove colouring and collapsible files, plus a `truncated` notice.
  - **Spec**: goal, deliverables, out of scope, DoD (checkboxes ticked from the latest verdict's evidence when present), lane.
  - Header: key, title, status, node, attempts, cost. Esc closes and calls `onClose`.
- Mirror §8 in each feature's `handshake.ts`. Use a local fallback status palette until C1.
- `Playground.tsx` per feature, driven from fixtures (a plan plus agent events and verdicts reconstructed from the run JSONL with a tiny local helper).
- Tests (happy-dom + Testing Library): DAG renders a node per task and edges per dep; click → `onSelectTask`; the drawer tabs switch; the activity list renders all kinds; the verdict card shows failing checks and fix instructions; the diff viewer counts lines and handles truncated; Esc → `onClose`.

## Explicitly out of scope
Global store and wiring (Epic 23/C1). Sky, queue, metrics, flock panels. Fetching data. Editing anything (read-only UI).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test apps/web/src/features/dag apps/web/src/features/agents` passes, ≥ 20 tests.
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-25-web-dag-agents.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/25-web-dag-agents.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/25-web-dag-agents`. Conventional Commits scoped to your lane (`feat(dag): …`, `test(dag): …`, `docs(epic-25): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
