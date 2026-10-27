<!--
  Starling PR template = the epic handback (AGENTS.md §6).
  Fill it in as you go: it is the only thing the Orchestrator reads when auditing
  your epic, and it becomes the merge commit's description.

  Title: epic(NN): <title>        Base: main        Head: epic/NN-slug
  Add `Closes #<issue>` below once, so the merge closes the epic issue.
-->

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

<!-- Checklist before you hit "Create pull request" -->
- [ ] Commits are Conventional Commits, scoped to my lane
- [ ] Only files inside my lane (+ `docs/epic-NN-slug.md`, `.orchestrator/handbacks/NN-slug.md`) changed
- [ ] `bun run test` and `bun run check` pass at the repo root (or the pre-existing failure is documented above)
- [ ] `git fetch origin && git rebase origin/main` is clean
- [ ] Doc and handback written
