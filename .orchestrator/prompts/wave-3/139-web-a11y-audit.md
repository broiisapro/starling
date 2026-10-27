# Epic 139: Web: accessibility audit

**Wave 3 · Branch `epic/139-web-a11y-audit` · Issue: `gh issue list --search "Epic 139 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 90–150 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees on this laptop and on other laptops ("perches"), audits each result, and merges everything through a queue, shown live in a murmuration dashboard.

**Waves 0, 1, C1 and 2 are merged** (tags `epic-NN-complete`). About 2,500 tests pass across every package, the CLI, server, web dashboard, skill, tools and evals. Epic 40 (integration captain) is landing the **real** composition (`starling run` driving real opencode agents) in parallel with you, so for now `apps/cli`, `packages/core`, `packages/llm`, `packages/runner` and `apps/web/src/data` are **off limits** (Wave 3b takes them after Epic 40 merges).

**Wave 3 is the big one: about 100 agents run at the same time on one laptop**, each in its own worktree and lane. That only works if everyone follows the rules below exactly.

**Read before you start:** `AGENTS.md`, `.orchestrator/ARCHITECTURE.md` (§6 contracts, §7 locked decisions), the `docs/epic-*.md` for every package you touch (their "Interfaces for future epics" sections), the handbacks in `.orchestrator/handbacks/` that mention your area, and **`.orchestrator/fix-requests-w2.md`**.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L31** still hold (Bun 1.4.4, TS 5.9.3, zod 4, Biome 2.6.3; web tests run in their own process; Markdown formatter off; no local models; real LLM calls only via the `opencode` profile). Wave 3 adds:
- **L32 Lanes are absolute.** Write only inside your lane, plus your own `docs/epic-139-web-a11y-audit.md` and `.orchestrator/handbacks/139-web-a11y-audit.md`. Shared registration files you don't own (`apps/web/src/App.tsx` and `app/Layout.tsx`, `apps/cli/src/program.ts`, `apps/server/src/app.ts`, any package `index.ts` outside your lane) are **wired later by checkpoint C3**. Ship your work as a self-contained module with the manifest described in your prompt, and say in the handback exactly what C3 must add (file, line, code).
- **L33 Public APIs are additive only.** Never rename or remove an export, field, route, CLI flag or event other code uses. Deprecate instead. About 100 branches merge after yours.
- **L34 No new dependencies.** Don't touch any `package.json` dependency list, `bun.lock`, the root `package.json`, `tsconfig.base.json` or `biome.json`. Everything you need is already installed (React 19, lucide-react, zustand, @xyflow/react, Tailwind v4, Hono, commander, zod, bun:test, happy-dom, Playwright). If something is truly missing, write a CONTRACT REQUEST instead.
- **L35 Heavy commands go through the slot gate.** With 100 agents, everyone running the full suite at once would melt the laptop. While iterating, run **only your own tests** (`bun test <your dir>`; for web code `cd apps/web && bun test src/features/<x>`) and **only your own typecheck** (`bunx tsc --noEmit -p <your package or app>`). Run the full suite **once, at the end**, through the gate: `bash .orchestrator/bin/heavy.sh bun run test` and `bash .orchestrator/bin/heavy.sh bun run check` (also wrap `bun run build` and any Playwright run). The gate may print "waiting" for a few minutes. If your shell tool times out while it waits, just run it again.
- **L36 Bugs outside your lane are FIX REQUESTS, never edits.** QA epics record a confirmed bug as **`test.todo('BUG <area>: <one line>', () => { ... })`** with the real assertions inside, plus a FIX REQUEST. Never use `test.failing` and never commit a red test: about 100 fixes land in parallel, and a `test.failing` turns red the moment someone fixes the bug. **The one allowed cross-lane edit:** if your fix makes an existing `test.failing` probe in `tools/security/**` pass, change that probe's `test.failing(` to `test(` in the same PR (nothing else in that file) and say so in the handback.
- **L37 No real model calls and no real Starling runs in Wave 3a** unless your prompt says otherwise. Use the recorded runs in `fixtures/runs/*.jsonl`, `@starling/core/testing` fakes and the mock compose paths. No Ollama, no local models (L23).
- **L38 Tests live next to the code, and everything is deterministic.** No sleeps over 50 ms, no wall-clock assertions, no network beyond `127.0.0.1` on port `0`, and temp dirs under `os.tmpdir()` that clean up after themselves. Another 99 agents are hammering the CPU, so timing-sensitive tests will flake.
- **L39 QA epics.** You are a bug hunter, not a fixer. Read the code and docs of your area, then write **behaviour tests** that pin down what the docs/contracts promise, importing only public exports (`packages/<x>/src/index.ts` by relative path, or the app's exported factories). Tests that pass are kept as regression tests. A confirmed bug becomes `test.todo('BUG <area>: …', () => { …real assertions… })` plus a FIX REQUEST in your handback with file, line, a minimal repro, and a suggested fix. Aim for 40+ meaningful tests and every bug you can find. Don't invent behaviour the docs don't promise: if the contract is ambiguous, write it up as an **Open question** instead. Also write `REPORT.md` in your folder: what you covered, a bug table (id, severity, file:line, one-line repro), and what you'd test next.
- **Your tests must survive 15 web merges.** Shell (112) and features (130–137) change in parallel. Assert semantics (roles, accessible names that docs promise, relationships, focus moves), never exact copy, class names or DOM depth. Anything that only holds after an unmerged sibling change is out of scope: note it for a follow-up audit.
- Web tests run in their own process: `cd apps/web && bun test src/__a11y__`. Keep the whole folder under ~3 s.

## FIRST TASK: carryover
Open `.orchestrator/fix-requests-w2.md`. Implement every request that targets a file in your lane, or decline it with a one-line reason. List each one in your handback under **Carryover done**.


## Your lane (you may write ONLY here)
`apps/web/src/__a11y__/**`
plus `docs/epic-139-web-a11y-audit.md` and `.orchestrator/handbacks/139-web-a11y-audit.md`. Read anything.

## Goal
Judges notice when a dashboard can't be driven from the keyboard or reads as soup to a screen reader, and open-source contributors notice even more. Every web epic so far promised roles, labels, focus behaviour and reduced motion, but nobody checked them across the whole app. This epic builds a small, dependency-free checker that runs in happy-dom, audits the shell and every existing feature, and turns each promise into a regression test. Each violation becomes a `test.todo` + FIX REQUEST routed to the Wave 3 epic that owns that code. Great looks like this: 60+ passing checks guarding the app as 15 web epics merge, and a precise bug list per lane.

## Deliverables
1. **`__a11y__/checker.ts`** (no axe, L34): `auditDom(root: Element, opts?): A11yIssue[]` with `A11yIssue = { rule: string; severity: 'error' | 'warn'; selector: string; message: string }`, plus `accessibleName(el: Element): string` (simplified accname: aria-labelledby → aria-label → native label/alt/text → title). Rules:
   - `button-name`, `link-name`, `form-label`;
   - `img-alt` (`<img>` alt; `<svg>` either `aria-hidden` or `role="img"` + name);
   - `aria-refs` (controls/labelledby/describedby ids resolve), `dup-id`;
   - `role-valid` (known ARIA roles; `tab` inside `tablist`; `tabpanel` labelled);
   - `tabindex-positive`, `aria-hidden-focusable` (no focusable inside `aria-hidden`/`inert`), `heading-order` (warn).
   - Self-tests: ≥ 15 good/bad snippets.
2. **Harness**: per-file happy-dom setup (copy `features/flock/test-dom.ts`), and `fixtureState(kind: 'empty' | 'mid' | 'end')` from `applyEvents(createInitialState(), demoEvents())` (`data/reducer`, `data/demo`; import only).
3. **Shell audit**: render `Layout` (`app/Layout.tsx`) with the end and empty states and run every rule. Verify the documented keyboard map with dispatched `KeyboardEvent`s on `document`: `1`/`2` switch view, `b`, `f`, `?` opens `KeyboardHelp`, Esc closes the help then the drawer. Also check the skip link targets `#region-sky` and inactive centre views are `inert` + `aria-hidden`.
4. **Feature audits**: sky, dag, agents (selected task, every tab), queue, metrics, flock (card + compact + "All roosts" sheet), launch (`LaunchPanel` with its exported fixtures) and about (`FIXTURE_STATS`), fed through `data/selectors`. One test per (feature × rule group) so failures are precise.
5. **Focus order**: `tabbables(root): HTMLElement[]` (DOM order, tabIndex rules, skipping hidden/inert). Assert the shell order: skip link → top bar → flock → centre view → strip. Check the documented focus moves: the flock sheet focuses its close button and returns focus on Esc (Epic 55); the drawer is a labelled non-modal dialog (Epic 25).
6. **Contrast tokens**:
   - Parse `apps/web/src/index.css` (and `src/lib/tokens.pcss` if tokens live there) for the custom properties under `:root` and `[data-theme="light"]`, and compute WCAG ratios for ink tokens on surface/panel tokens in both themes: ≥ 4.5:1 for body ink, ≥ 3:1 for meta/large.
   - Generalise the source scan in `features/metrics/legibility.test.ts` to **every** folder under `features/`, plus `app/` and `components/` (no `<12px`, no `13px`, low-contrast slate on dark). Hard-coded dark-only colours that won't flip in light mode go under **Open questions**.
7. **Reduced motion**:
   - With `matchMedia('(prefers-reduced-motion: reduce)')` mocked to match, the Sky gets `reducedMotion`, and queue/metrics/flock expose `data-reduced-motion="true"`.
   - A source scan finds every `@keyframes`/`animation`/`transition` in `index.css` and in feature `<style>` strings (`QUEUE_STYLES`, `MOTION_CSS`, …) and checks each is neutralised under `@media (prefers-reduced-motion: reduce)`.
8. **Live regions**: the places the docs promise announcements (`aria-live` on queue/metrics updates, copy confirmations) actually carry them.
9. **Routing** in `REPORT.md` and the handback:
   - shell/`components`/`lib` → Epic 112;
   - sky 130 · dag 131 · agents 132 · queue 133 · metrics 134 · flock 135 · launch 136 · about 137;
   - data → Wave 3b (204).

## Explicitly out of scope
- Fixing anything outside `__a11y__` (FIX REQUESTS only).
- Playwright and real-browser checks (Epic 140). The web QA lanes `__qa__/core` and `__qa__/features` (Epics 191/192).
- Unmerged Wave 3 features (stage, topology, health, report, …): list them in REPORT.md as "audit after C3".

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree (it must not change `bun.lock`).
2. `cd apps/web && bun test src/__a11y__` → 0 fail, ≥ 60 passing tests plus one `test.todo` per confirmed violation.
3. `bunx tsc --noEmit -p apps/web` clean and `bunx biome check apps/web/src/__a11y__` clean.
4. `apps/web/src/__a11y__/REPORT.md` has the coverage table (feature × rule) and the bug table routed to owning epics, with the contrast ratios computed for every ink/surface token pair in both themes.
5. `bash .orchestrator/bin/heavy.sh bun run test` at the repo root → 0 fail (paste both halves' summary lines).
6. `bash .orchestrator/bin/heavy.sh bun run check` → clean.
7. `docs/epic-139-web-a11y-audit.md` (AGENTS.md §6 sections) and `.orchestrator/handbacks/139-web-a11y-audit.md` written. The handback has **Carryover done**, **C3 wiring** (exact code C3 must add, or "none") and **FIX REQUESTS** (or "none") sections. PR opened per AGENTS.md §6 with `Closes #<issue>`. Print the PR URL last.

## Git
Branch `epic/139-web-a11y-audit`. Conventional Commits scoped to your lane, committed small and often (at least 5 commits). `git fetch origin && git rebase origin/main` before pushing. No merging, no tags. Never `git add -A` at the repo root without checking `git status` first: only your lane's files belong in the PR.
