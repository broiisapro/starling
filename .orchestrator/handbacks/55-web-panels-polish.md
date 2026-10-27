## Epic 55 Handback — Web panels polish (DAG, drawer, queue, metrics, flock)

**Status:** Complete. Branch `epic/55-web-panels-polish`, rebased on `origin/main`; panels as of `7e7f347`.

**Delivered:**
- **Legibility floor, enforced in source.** `apps/web/src/features/metrics/legibility.test.ts` scans
  all 5 lane folders (and a guard test proves the scan is non-empty across every folder) for: no text
  below 12 px, no 13 px, no `slate-500`…`900` (≈<4.5:1 on dusk), no shell `text-micro`/`text-caption`
  tokens in panel cards. Every counter is `tabular-nums`.
- **DAG** — `dag/critical-path.ts` (longest chain by summed `estimateMin`, memoised, cycle-guarded,
  stable tie-breaks) drawn as a legend chip + `data-critical` nodes + highlighted edges;
  `dag/use-status-flash.ts` (700 ms arrival glow, no flash on mount, collapse on fast replay, dropped
  under reduced motion); `dag/follow.ts` (`followTarget`, `aria-pressed` toggle, pans to `setCenter`);
  auto-`fitView({padding:0.18})` on `Plan.id` change; lane legend (`owns`/`reads`) on node hover.
- **Agent drawer** — `drawer-elapsed` / `drawer-cost` live header (clock ticks only in live statuses,
  freezes otherwise); `agents/activity.ts` pairs `tool.call`→`tool.result` and collapses repeats
  ("ran tests ×3"); file-edit chips switch to the Diff tab and scroll to the file; "Jump to latest"
  pill only when scrolled off the tail; Audit tab renders `checks` (+`durationMs`) and, feature-detected,
  `AuditVerdict.dod` as a checklist with evidence quotes; `agents/diff.ts` + `word-diff.ts` give
  word-level highlights on small hunks.
- **Metrics** — `count-up.ts` (550 ms ease-out cubic) for the API figure, **snapped** on replay/scrub;
  `pricing.ts` `peakNote()` renders `off-peak $0.02` with the peak-tariff/budget-guardrail reasoning in
  the tooltip; local-calls counter; "you saved" with an audit-able tooltip (`estSavedUsd` from core
  preferred).
- **Queue** — `selectedTask` highlight (optional prop, `aria-current`); per-column scroll containers
  with `overscroll-contain` so a click cannot scroll-jump the board; `queue/window.ts` virtualisation
  above 30 cards with honest spacer rows and a `↕` affordance; `taskNodeLabel` prefers `nodeName` then
  falls back to `nodeId`; cards are one line so a fixed 12 rem strip shows more than one per column.
- **Flock** — compact rail "All roosts" drawer with the real `RoostCard`s (portalled to `document.body`
  because the rail's `backdrop-filter` broke `fixed`), Escape-to-close + focus on the close button;
  join card showed whenever `join` exists and a neutral "Join info unavailable" (never "off") when
  nodes > 1; hardware split into two `whitespace-nowrap` atoms so it never breaks inside "32 GB";
  dropped the nested card frame the shell's `Panel` already provides.
- **Playgrounds** updated for the behaviours they show (flock compact toggle, recorded run for
  queue/meter, plan selection for the DAG). **Screenshots** committed to
  `apps/web/src/features/dag/__screens__/` (129 KB, 174 KB, 293 KB — all under 300 KB).

**Key design decisions:**
- Assert the legibility floor against **Tailwind classes in source**, not `getComputedStyle` — happy-dom
  has no stylesheet, so a computed check would pass silently; a source scan also covers cards no test
  renders.
- Critical path by **estimate**, not task count — the chain whose minutes sum highest sets the run's
  wall-clock floor; a wide fan-out is not critical.
- Follow-the-action settles on the **oldest** live task when nothing is new — following the newest every
  tick made the camera ping-pong between two agents, which is hostile on a projector.
- Count-up **snaps** on replay: a judge scrubbing a recording is reading exact numbers, so animating
  them would misstate the value at that timestamp.
- `apps/web` must not import core's zod/config graph, so `pricing.ts` encodes the half-of-peak ratio and
  a Bun test imports the real `PRICING` to pin it — the note fails loudly if DeepSeek's tariffs change.
- Carryover props (`selectedTask`, `nodeName`) are **read structurally** (`TaskRunWithNodeName`) so the
  panels are correct before and after Epic 40, with no `any` and no version branch.
- Queue cards became **one line**: at 14 px in a fixed 12 rem strip a two-line card left one visible
  card per column. The row is still a button whose accessible name spells out status, attempts, node
  and blocked/merge reason; the tooltip carries the rest.

**Verification (exact commands + results):**
- `bun install` (worktree): `Checked 162 installs across 221 packages (no changes)`
- `cd apps/web && bun test`: `503 pass / 0 fail`, 3775 expect() calls, 50 files
  - before this session's two fixes: `498 pass / 0 fail` (so +5 tests, all new)
- `bun run test` (root, after `git fetch origin && git rebase origin/main`):
  - packages/servers/cli/skills/integrations/tools/evals: `1359 pass / 4 skip / 0 fail` — 1363 tests across 162 files
  - `── bun test: apps/web (separate process) ──`: `503 pass / 0 fail` — 50 files
- `bun run check`: Biome `Checked 725 files in 178ms. No fixes applied.` + per-workspace `tsc --noEmit`
  loop completed with no output and exit 0.
- **Real-browser checks** (Chromium via a throwaway Playwright script against `vite --port 5199`; the
  script lives outside the repo, no dependency added):
  - DAG 1600×900: `critical cards: ['task-node-due-badges','task-node-dates-fix']`,
    legend `critical path 25 min · 2 tasks`.
  - Drawer 1440×900, Audit tab: 2 verdict cards rendered, 0 console/page errors.
  - Dashboard 1440×810 at the end of the recorded run: `queue cards on the wire: 7`,
    `cost: $0.04`, `off-peak: off-peak $0.02`, `placeholders: 0`, `errors: none`.
  - 1280×720 compact rail: `{"compact":true,"chips":2,"cards":0}` → drawer
    `{"drawer":true,"cards":2,"chips":7,"withinViewport":true,"overflowX":0}`.
  - 1280×720 and 1920×1080 both: `overflowX: 0`, `overflowY: 0`, `minFontPx: 12`,
    `wireCards: 7`, `placeholders: 0`, `errors: []`.

**Dependencies added:** none (Playwright was not added to `apps/web`; screenshots came from an external
scratch harness).

**FIX REQUESTS:**
1. **Epic 40 — `packages/core/src/contracts.ts`:** add `nodeName?: string` to `TaskRun`. The queue card
   wants the node's display name without a selector lookup; today it renders the id. Already handled
   structurally (`TaskRunWithNodeName = TaskRun & { nodeName?: string }` in `queue/node-name.ts`), so
   this is additive and non-blocking.
2. **Epic 40 — `packages/core/src/handshake.ts`:** add `selectedTask?: string` to `MergeQueueProps` /
   the queue handshake. The board highlights the selected card today behind an optional prop; promoting
   it removes the local mirror.
3. **Epic 41 (layout) — queue column widths:** the six queue columns are equal `flex-1`, so five empty
   stages take five sixths of the board while "On the wire" scrolls at 7+ cards. Occupied columns should
   grow proportionally. This is a shell grid decision, so it was not made from this lane.

**Deliberately deferred / out of scope:**
- Sky (Epic 47), data layer/layout (Epic 41), launch panel (Epic 53), stats page (Epic 68), core types
  (Epic 40) — untouched.
- Queue column widths (FIX REQUEST 3).
- Audit check-name column wraps at hyphens ("definition-of-" / "done"); readable, slightly untidy.
- The compact rail's bare task-count badge (`5` next to `0/8`) is explained by its tooltip only — no
  room for "5 tasks" at 15 rem.
- Virtualisation is per column; a single-column phone layout would want its own threshold.

**Open questions / flagged tradeoffs:**
- **Count-up vs exactness on the final sample.** The meter animates while `live` and snaps otherwise.
  If the shell ever marks a finished run as `live`, the last figure would animate once; the shell
  currently passes `live` only while streaming.
- **`off-peak` note wording** was shortened from `peak rates · off-peak ≈ $0.02` to `off-peak $0.02`
  to fit the ~110 px column at 1280; the full explanation lives in the tooltip. Anyone reading only the
  note sees the cheaper figure without the word "peak", hence the `API · DeepSeek` label directly above
  it. Flagging in case product prefers the longer line plus a taller strip.
- **Flock de-chrome** assumes the shell keeps wrapping the panel in a titled `Panel`. Rendered
  standalone (the Playground), flock has no title of its own any more; the Playground page title covers
  it. If a future host renders it bare, it will need a heading back.
