## Epic 25 Handback — Web: DAG + agent drawer

**Status:** Complete. Branch `epic/25-web-dag-agents` @ `34ef760` (plus this docs/handback commit). Closes #19.

**Delivered:**

- `apps/web/src/features/dag/`
  - `DagView` — React Flow graph laid out left→right by Dagre, memoised by plan id (`layout.ts`), fit-to-view on
    plan change, minimap toggle, controlled selection, direction-nearest arrow-key navigation, friendly empty state.
  - `TaskNode` cards — status colour + icon + label, key, short title, node badge, attempts, elapsed; hover reveals
    lane `owns` globs; selected card gets a ring.
  - Edges animate exactly while downstream waits on a live upstream (`edgeAnimates`, unit-tested); arrow markers and
    colour update with state.
  - `handshake.ts` mirror of ARCHITECTURE §8; local fallback status palette (literal Tailwind classes).
- `apps/web/src/features/agents/`
  - `AgentDrawer` — right-side non-modal dialog, four ARIA tabs, Esc/✕ close, header with key, title, status pill,
    node, attempts, cost, event count.
  - Activity tab — `buildTimeline` normalises events (session start, prose, paired tool call/result, file chips, usage
    footers, idle/error), MarkdownLite prose (fenced + inline code, no HTML), collapsible tool rows, tail-following
    with a jump-to-latest pill, windowed rendering above 80 events (verified with 500).
  - Audit tab — newest-first verdict cards, pass/fail banner, checks table (name/ok/detail/duration), lane
    violations, fix instructions as a numbered list.
  - Diff tab — summary file list with +/−, per-file collapsible unified patch with per-line add/del/hunk colouring,
    truncated notice, graceful handling of files with no textual patch.
  - Spec tab — goal, deliverables, out of scope, DoD checkboxes ticked from the latest verdict's DoD check, lane
    owns/reads; evidence line.
  - `handshake.ts` mirror of §8.
- Fixture-driven playgrounds: `features/dag/Playground.tsx` + `features/agents/Playground.tsx`, each with its own
  `playground.html` / `playground-main.tsx`, served by Vite at `/src/features/{dag,agents}/playground.html`.
  `features/dag/run-jsonl.ts` replays the committed launch-day JSONL through the production zod schema.
- 91 tests in the two feature folders (29 dag, 62 agents including 3 run-jsonl), all with no network calls.

**Key design decisions:**

- Declared React Flow node `width/height/measured/handles` instead of trusting `ResizeObserver`. Edges are withheld
  until both endpoints are "initialised"; declaring geometry makes the first paint deterministic and lets
  happy-dom/SSR renders contain real edges. This is the difference between 0 and 2 rendered edges in tests.
- Dagre layout lives in a pure, id-memoised module; animation is a pure predicate. Both are tested without a browser.
- Selection is controlled by props; drawer tab state is local. Matches the §8 props-only contract and lets the shell
  drive selection from the Sky.
- Activity windowing uses a uniform 76px estimate + 8-row overscan above 80 rows, not per-row measurement —
  cheaper at 500 events and adequate for prose rows.
- Tool call/result pairing happens in `buildTimeline` (pure) rather than in JSX, so "one row per tool use" is
  unit-tested.
- DoD ticking is deliberately conservative: pass → all ticked; fail → none ticked. A green box must mean the
  auditor said so (contract lacks per-item evidence).
- Fix instructions split on newlines then sentences with bullet/number stripping. Heuristic, documented, tested;
  may over-split abbreviations.
- Tests avoid Testing Library's `screen` (bound to `document.body` at import time, before this lane registers
  happy-dom under the root runner) and use each `render()`'s bound queries; the DOM is re-registered in `beforeEach`
  because another lane's teardown can unregister happy-dom between files.
- Non-modal drawer (no backdrop) so the DAG stays explorable while reading; Esc is bound on `document`.

**Verification (exact commands + results):**

- `bun install` (worktree): `Checked 133 installs across 192 packages (no changes)`.
- `bun test apps/web/src/features/dag apps/web/src/features/agents`: `91 pass, 0 fail — 251 expect() calls, 11 files`.
- `bun run test` (root): `278 pass, 0 fail — 1039 expect() calls, 48 files` (`Ran 278 tests across 48 files. [337.00ms]`).
- `bun run typecheck` (all 18 workspaces): exit 0, no output.
- `bun run check`: **fails in Biome on pre-existing files outside this lane**: `docs/epic-01-demo-target.md`,
  `docs/epic-02-repo-ops.md`, `tools/local-models/host.ts`, `tools/local-models/ollama.ts`,
  `tools/local-models/ollama.test.ts`, `tools/local-models/smoke.ts` (+organizeImports),
  `tools/local-models/results/*.json` (2). All come from Epics 01/02 and are untouched here
  (`git diff --name-only origin/main...HEAD` contains none of them). Scoped check is green:
  `biome check apps/web/src/features/dag apps/web/src/features/agents docs/epic-25-web-dag-agents.md` → 44 files, 0 errors.
  Because the root script is `biome && typecheck`, the typecheck half was also run directly and passed.
- Vite dev smoke (port 54321, killed after): `/src/features/dag/playground.html` → 200, `Playground.tsx` → 200
  (10,738 bytes transformed), `/src/features/agents/playground.html` → 200, `Playground.tsx` → 200 (18,590 bytes),
  fixture `?raw` import resolves to `/@fs/.../fixtures/runs/sky-todo-launch-day.jsonl?import&raw`.

**Dependencies added:** none. `@xyflow/react@12.12.0` and `@dagrejs/dagre@3.1.3` were pre-installed by Epic 00; no
`package.json` change was needed.

**CONTRACT REQUESTS:**

1. `AuditCheck` → add optional `durationMs?: number`. The drawer's checks table has a duration column (deliverable),
   but §6 has no timing field. Implemented with a local `AuditCheckWithDuration` and an em dash fallback; a proper
   field would let the auditor surface real timings.
2. `AuditVerdict` → add optional per-item DoD evidence, e.g. `dod?: { item: string; ok: boolean; detail?: string }[]`.
   Today the UI can only tick all or none from a single `definition-of-done` check; per-item evidence would make the
   Spec checklist accurate (e.g. `Missing: toggle persists across reloads` vs the item text).
3. (Nice to have, not blocking) a shared status palette / `TaskStatus` presentation module in core at C1, so DAG,
   queue and flock use the same colours instead of three local fallbacks.

**Deliberately deferred / out of scope:**

- Global store, SSE, data fetching and all wiring (Epic 23/C1). Both components are pure props.
- Sky, merge queue, metrics, flock panels; no changes to `App.tsx`.
- Editing, aborting, retrying or any mutation from the drawer (read-only by assignment).
- Measurement-based virtualization, syntax highlighting, word-level diffing, mobile layout.
- Live elapsed clock in the drawer header (elapsed ticks on the DAG card while a task is live).
- `*.live.test.ts`: nothing in this lane talks to a network, engine or opencode, so none were needed.

**Open questions / flagged tradeoffs:**

- Node badge is `run.nodeId` (e.g. `M2-Air`), not the perch's display name, because `NodeInfo` is not in the §8 props.
  If the shell wants names it can map ids before passing `tasks` (or a later contract can add `nodeName` to `TaskRun`).
- The agents playground imports `../dag/run-jsonl` (both in this lane, dev-only). When the store lands, both
  playgrounds should switch to replayed `StarlingEvent`s and `run-jsonl.ts` can be deleted.
- The recorded fixture has no `DiffSummary`, so the agents playground's patch body is illustrative (labelled in the
  UI); counts come from real `file.edited` events.
- `bun run check` red on `main` is an integrator fix (format-only) outside this lane.
