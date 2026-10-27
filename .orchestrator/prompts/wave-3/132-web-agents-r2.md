# Epic 132: Web: agent drawer round 2 (split diff, verdict explanations, fix prompt, search)

**Wave 3 · Branch `epic/132-web-agents-r2` · Issue: `gh issue list --search "Epic 132 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-132-web-agents-r2.md` and `.orchestrator/handbacks/132-web-agents-r2.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **Legibility floor is enforced across lanes.** `apps/web/src/features/metrics/legibility.test.ts` (Epic 55, metrics lane) scans every non-test `.ts/.tsx` in `dag`, `agents`, `queue`, `metrics` and `flock`: no `text-[<12px]`, no `text-[13px]`, no `text-slate-500`…`900` (or gray/zinc/neutral/stone), no shell `text-micro`/`text-caption` tokens. New code in those folders must pass it; run it with your own tests (`cd apps/web && bun test src/features/metrics/legibility.test.ts`).
- **Additive props only, the existing way.** New inputs are optional props declared in your feature's `types.ts` extras intersection (pattern: `DagViewExtras`, `QueueExtras`, `MetricsExtras`, `FlockPanelExtras`), so the component still satisfies the frozen §8 props from `@starling/core`. `app/Layout.tsx` is Epic 112's: in the handback's **C3 wiring** give the exact prop expression C3 should add at the call site (e.g. `tasks={activeRunOf(state)?.tasks}`), and make the component behave well when it's absent.
- Test DOM pattern: copy `features/flock/test-dom.ts` (register happy-dom defensively, `react-dom/client` + `act`, no Testing Library `screen`). Web tests run in their own process: `cd apps/web && bun test src/features/<x>`.
- Visible changes will break the two e2e visual baselines (`apps/web/e2e/__screenshots__/end-*.png`, Epic 140's lane). Don't re-record them; write "C3: re-record e2e baselines (`bun run --cwd apps/web e2e:update`)" in the handback.
- e2e and the shell rely on `data-testid="agent-drawer"`, `data-testid="drawer-status"`, the button named "Close agent drawer", and the drawer root being an `<aside>` (Layout pins it with `[&>aside]` selectors). Keep all four.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`apps/web/src/features/agents/**`
plus `docs/epic-132-web-agents-r2.md` and `.orchestrator/handbacks/132-web-agents-r2.md`. Read anything.

## Goal
The agent drawer is where a judge asks "but what did the agent actually do?". Round 2 answers in seconds:
- a side-by-side diff for real reading;
- a plain-English "why" for every audit verdict;
- the full fix-attempt history (attempt 1 ✗ → 2 ✗ → 3 ✓, with what changed between them);
- a search over a 500-event log;
- a "copy fix prompt" button that turns a failed verdict into a ready-to-paste prompt for any coding agent, which demonstrates the open-weight loop in one click.

Everything stays props-only and read-only.

## Deliverables
1. **Split diff**:
   - Pure `toSideBySide(lines: PatchLineView[]): SideBySideRow[]` with `SideBySideRow = { kind: 'context' | 'change' | 'add' | 'del' | 'hunk'; left?: PatchLineView; right?: PatchLineView }`. It pairs del/add runs inside a hunk and keeps the existing word highlights (`annotateWordDiffs`).
   - The drawer is only 22 rem wide in the shell, so split mode lives in an **"Open full diff"** dialog: portalled to `document.body`, about 92vw, focus trapped, Esc closes it and returns focus to the button.
   - A Unified/Split toggle (`aria-pressed`) is remembered in localStorage `starling.diffMode` (try/catch, typed guard).
2. **Verdict explanations**: pure `explainVerdict(v: AuditVerdict): { headline: string; reasons: string[] }`.
   - Map the auditor's real check names (read `packages/auditor/src/`: at least `tests`, `lane`, `lint`, `definition-of-done`, `diff`) to plain sentences that include the check `detail` (truncated), list lane violations, and summarise `dod` items when present.
   - Feature-detect an additive `explanation?: string` on the verdict (Epic 103 is adding a dashboard-ready explanation in parallel) and prefer it. The Audit tab shows the headline plus a "Why?" disclosure.
3. **Copy fix prompt**: pure `buildFixPrompt(input: { task?: TaskSpec; verdict: AuditVerdict; diff?: DiffSummary }): string`.
   - Markdown containing the task key/title, deliverables, failing checks with details (each truncated to 400 chars), lane violations, `fixInstructions`, `owns`/`reads` and an explicit "Only touch files matching: …" line.
   - Deterministic output; snapshot-test it.
   - The button shows only on failing verdicts and uses `navigator.clipboard.writeText` with a textarea + `execCommand('copy')` fallback, a "Copied ✓" state and `aria-live`.
   - Write it locally: don't import `packages/prompts` (Epic 109 is changing it).
4. **Log search** (Activity tab):
   - Pure `searchTimeline(entries: TimelineEntry[], query: string): number[]`, case-insensitive over prose, tool names, args and file paths.
   - An input with a "3 of 12" counter; Enter/Shift+Enter jump next/prev and scroll to the match through the existing windowing (`windowing.ts`, active above 80 rows); `<mark>` highlights. Esc in the input clears it (the shell's Esc handler already skips inputs).
5. **Fix-attempt history** (Audit tab):
   - A stepper "Attempt 1 ✗ → Attempt 2 ✗ → Attempt 3 ✓" from `sortVerdicts(verdicts)`, where each step selects that verdict.
   - Pure `attemptDeltas(verdicts): { attempt: number; fixed: string[]; broke: string[] }[]` (checks that flipped). The Activity tab shows attempt separators where a `session.started` follows a failing verdict.
6. **Accessibility and legibility**: every new control is keyboard reachable with a name, the tab ARIA from Epic 25 is unchanged, and the dialog is `role="dialog" aria-modal="true"` with a labelled title.
7. **Playground**: add a 3-attempt fixture (fail lane → fail tests → pass), a 300-line patch, and a 500-event log to `test-fixtures.ts`/`Playground.tsx`.
8. **Tests (≥ 35 new)**: the pure helpers (pairing edge cases: pure adds, pure deletes, uneven runs, hunks), the explanation mapping incl. `explanation` precedence, prompt snapshot + truncation, search + windowed scroll, deltas, clipboard fallback, dialog focus trap/return, and localStorage that throws.

## Explicitly out of scope
- Refreshing a cached diff after a later fix attempt (Epic 41 deferred): that's shell/data (Epics 112/204).
- Auditor verdict content (Epic 103) and prompt templates (Epic 109).
- Drawer width and placement in the layout (Epic 112).
- No mutations: the drawer never retries, aborts or edits.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/features/agents src/features/metrics/legibility.test.ts` → 0 fail, ≥ 35 new tests.
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/features/agents` clean.
4. Paste `buildFixPrompt` output for the Playground's failing attempt in the handback, and commit 1 PNG ≤ 300 KB of the split-diff dialog to `features/agents/__screens__/`.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-132-web-agents-r2.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/132-web-agents-r2.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/132-web-agents-r2`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
