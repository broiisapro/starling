# Brief: write Wave 3 epic specs for Starling

You are helping an Orchestrator write **epic prompts** for ~100 parallel coding agents (DeepSeek V4.1 Flash in opencode, headless, fully autonomous, each in its own git worktree and "lane"). Each agent receives ONE markdown prompt and must finish its epic alone, without asking questions. Good prompts are concrete: exact file paths, function/type signatures, acceptance criteria, test expectations, grounded in the real code.

## Inputs (read these)
- Repo snapshot (= `main` after Wave 2, minus Epic 40): `/home/claude/audit/w2f/hacktoberfest-q-26` (branch `w2-trial`). Read-only: **do not modify it, do not run git commands that change it** (no checkout/commit). You may run read-only commands and `~/.bun/bin/bun test <dir>` if useful.
  - `AGENTS.md`, `.orchestrator/ARCHITECTURE.md`, `.orchestrator/PRD.md`, `docs/epic-*.md` (every package's design + "Interfaces for future epics"), `.orchestrator/handbacks/*.md`.
  - Epic 40's branch (real composition, not yet merged) is `epic/40-integration-captain` in the same repo: `git -C <repo> show epic/40-integration-captain:<path>` / `git diff w2-trial...epic/40-integration-captain --stat` if you need it.
- Compiled FIX REQUESTS from Wave 2: `/mnt/user-data/outputs/starling/.orchestrator/fix-requests-w2.md`.
- The shared prompt header + renderer: `/home/claude/plan/w3/w3_common.py` (read `HEADER` and the `*_CONVENTION` strings fully: rules L32–L39 are already in every prompt, so don't repeat them, and never contradict them).
- The master list of epics: `/home/claude/plan/w3/w3_list.py` (tuples: nn, slug, title, lane, intent, convention, group). Your group is given in your task. Keep nn, slug, title (you may sharpen the title slightly), lane and convention exactly as listed (except: you may NARROW a lane, never widen it, and never overlap another epic's lane).
- An example of a finished Wave 2 spec in the same dict format: `/home/claude/plan/w2_specs.py` (look at 2–3 entries to calibrate depth and tone).

## Output
Write `/home/claude/plan/w3/specs_<GROUP>.py` containing `SPECS = [ {...}, ... ]`, one dict per epic in your group, keys:
- `nn`, `slug`, `title`, `lane` (markdown, e.g. "`packages/flock/**`"), `wave` ("3", or "3b" for group E), `convention` (None, "web", "cli" or "qa" exactly as in the list).
- `budget` (e.g. "60–120 min"; use "90–150 min" for big ones).
- `goal` (1 paragraph: why it matters for the demo/judges/product, what "great" looks like).
- `deliverables` (markdown numbered list, **6–14 items**, each concrete: files to create, exported names with TypeScript signatures, behaviours, edge cases, tests to write with rough counts. Reference the REAL existing APIs/files you found by reading the code).
- `oos` (markdown bullets: what not to do, especially neighbouring lanes and who owns them).
- `dod` (python list of strings: 3–6 **scoped** verification steps, e.g. "`bun test packages/flock` → 0 fail, ≥ 40 new tests", "`bunx tsc --noEmit -p packages/flock` clean", a demo command and what its output must show. **Do not** include the full `bun run test` / `bun run check` / docs / PR steps: the header adds those.)
- `carryover` (markdown bullets: the specific Wave 2 FIX REQUESTS / SEC-xx findings from fix-requests-w2.md that target this lane, each with source epic + one-line summary; or "" if none. Search the file for the lane's paths and package names.)
- optional `extra_locked` (markdown bullets of extra rules specific to this epic, e.g. coordination notes with a sibling epic running in parallel: "Epic 105 is adding `gcWorktrees` in parallel; don't wait for it, ...").

Write plain single braces in strings (no `{{`). Use normal Python triple-quoted strings. Keep each rendered prompt roughly 70–140 lines.

## Rules for content
- Respect the off-limits areas for Wave 3a (header): `apps/cli` (except `src/ext/<name>/`), `packages/core`, `packages/llm`, `packages/runner`, `apps/web/src/data`. Wave 3a epics may *import* from them but never edit. Group E (Wave 3b) owns those after Epic 40 merges.
- No new dependencies, no real model calls, no real Starling runs (except Epic 207), no local models. Tests deterministic.
- Parallel siblings: an epic must not depend on another Wave 3 epic's code being merged. If it would benefit, tell it to code against the documented interface with a local fallback/shim and note the C3 wiring.
- Keep it fun and demo-focused where relevant (this is a hackathon: Hacktoberfest Queen's 2026; judges see the dashboard and a live demo).
- Be honest about scope: an agent has ~1–2 hours.

## Verify before finishing
Run: `cd /home/claude/plan/w3 && python3 -c "from w3_common import render; from specs_<GROUP> import SPECS; import w3_list; ids=[s['nn'] for s in SPECS]; print(len(SPECS), ids); [render(s) for s in SPECS]; print(render(SPECS[0])[:3000])"` and fix any errors. Check that every nn in your group appears exactly once.

Reply with: the file path, the count, and 1 line per epic noting anything surprising you found in the code (e.g. a FIX REQUEST already done, an API that doesn't exist, a lane problem). Keep the reply under 400 words.
