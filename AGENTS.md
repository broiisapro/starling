# AGENTS.md — standing rules for every coding agent in this repo

You are one of up to ~35 agents, spread across two laptops, working **at the same time** on Starling. Each agent has its own git worktree and branch. Your assignment is a prompt file under `.orchestrator/prompts/`. These rules apply on top of it. When they conflict, your assignment's **Lane** and **Out of scope** win, and everything else here still applies.

## 0. Read first, every time
1. Your assignment prompt, top to bottom.
2. `.orchestrator/ARCHITECTURE.md`, especially §3 layout, §6 contracts and §7 locked decisions.
3. `.orchestrator/PRD.md` (skim, for product context).
4. Existing code in your lane, and `packages/core` (contracts, ports, mocks).

## 1. Lanes: the one rule that makes parallelism work
- You may **only create or modify files inside your lane** (listed in your assignment), plus your own `docs/epic-NN-slug.md` and `.orchestrator/handbacks/NN-slug.md`.
- You may **read** anything.
- **Never edit**: `packages/core/src/contracts.ts`, `packages/core/src/ports.ts`, root config files (`package.json`, `tsconfig*.json`, `biome.json`), `AGENTS.md`, `opencode.json`, or anything in `.orchestrator/` other than your handback. Epic 00 is the exception: it owns root files and core.
- If you need a contract change, a new shared type, or a root config change, **don't make it**. Work around it locally inside your lane (a local type or adapter) and file a **CONTRACT REQUEST** in your handback.
- Import sibling packages only through their public `src/index.ts`, and in Wave 1 prefer the **ports + mocks from `@starling/core`** over real siblings (siblings are being written right now, in parallel).

## 2. Dependencies
- Adding an npm dependency to **your own package's `package.json`** is allowed. Run `bun install` in your worktree.
- **Never hand-edit `bun.lock`.** Lockfile conflicts are resolved by the integrator at merge time. List every dependency you added in your handback.
- Pin exact versions (no `^`). Prefer what's already installed in the workspace.

## 3. Git
- You are on branch `epic/NN-slug` in a worktree. **Don't switch branches, don't touch `main`, don't merge anything, don't create tags.**
- **Conventional Commits**, scoped to your lane: `feat(planner): lane overlap validator`, `test(workspace): merge-tree conflict cases`, `docs(epic-12): ...`.
- Commit small and often (at least every meaningful step). Never commit secrets, `.env`, `node_modules`, `.starling/`, or `*.db`.
- When done: `git fetch origin && git rebase origin/main`, re-run checks, `git push -u origin HEAD`, then open a PR (sec. 6).

## 4. Quality bar (your definition of done always includes these)
- `bun install` works from a clean worktree.
- `bun run test` at the **repo root** passes, which means everyone's tests, not just yours. (Use the root script, not bare `bun test`: the script excludes `examples/` and `fixtures/`.) If someone else's test fails on `main` and not because of you, note it in the handback; don't fix it outside your lane.
- `bun run check` passes (Biome + typecheck), or you document exactly which pre-existing failure isn't yours.
- Unit tests make **no network calls**. Anything hitting DeepSeek, Ollama, opencode or GitHub goes in `*.live.test.ts` (skipped unless `STARLING_LIVE=1`).
- No `any` without a `// reason:` comment. No dead code. No TODO without your epic number: `TODO(epic-12): ...`.

## 5. Investigate, don't ask
There is no human watching your session in real time. For anything you can settle by reading code, running a command, checking docs or making a reasonable low-stakes engineering call: **decide, and write down why** (in code comments or your epic doc). Only product or business questions go in the handback as *Open questions*. Never stop to wait for an answer.

## 6. Finish line: docs, handback, PR
1. Write **exactly one** doc: `docs/epic-NN-slug.md` with these sections: Goal · How it works · Key decisions & reasoning · Interfaces for future epics · Deviations from plan · Known limitations / deferred.
2. Write `.orchestrator/handbacks/NN-slug.md` using the template below.
3. Open the PR: `gh pr create --base main --title "epic(NN): <title>" --body-file .orchestrator/handbacks/NN-slug.md` and add `Closes #<issue>` if your assignment gives an issue number (otherwise find it with `gh issue list --search "Epic NN"`).
4. Print the PR URL as the very last line of your session.

### Handback template
```markdown
## Epic NN Handback — <Title>
**Status:** Complete | Partial (say what's missing). Branch `epic/NN-slug` @ <short sha>.
**Delivered:**
- <specific, auditable bullets: exported functions, files, behaviours>
**Key design decisions:**
- <decision> — <why, alternatives considered>
**Verification (exact commands + results):**
- `bun run test` (root): <N pass / N fail> — paste the summary line
- `bun run check`: <result>
- <any manual/live checks and their output>
**Dependencies added:** <pkg@version in package X> | none
**CONTRACT REQUESTS:** <precise proposed change + why> | none
**Deliberately deferred / out of scope:**
- ...
**Open questions / flagged tradeoffs:**
- ... | none
```

## 7. Style
- TypeScript strict, ESM, named exports, small files (< ~300 lines), pure functions where possible.
- Errors: throw `StarlingError` (from core) with a `code`. Never swallow errors silently.
- Logging goes through the EventBus `log` event or the provided logger. No stray `console.log` in library code (the CLI may print).
- Keep it fun. Bird puns in user-facing strings are encouraged, in moderation. 🐦
