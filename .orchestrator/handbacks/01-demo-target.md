## Epic 01 Handback — Demo target: `sky-todo`

**Status:** Complete. Branch `epic/01-demo-target` code tip `9def714` (docs commit on top).

**Delivered:**

- `examples/sky-todo` — vanilla TS + Vite todo app, standalone (own `package.json`,
  `bun.lock`, `tsconfig.json`, tests). 12 modules + 12 test files, 71 tests.
  - `src/store/todos.ts` — `createTodoStore()` with `add/update/toggle/remove/clearDone/replaceAll/subscribe`, `Todo {id,title,done,createdAt,due?,tags[]}`.
  - `src/store/persist.ts` — localStorage schema **v2**, `migrations[1]` + `migrateState()`, corrupt/newer-version handling.
  - `src/ui/slots.ts` — `createSlotRegistry()` with 5 slots (`header-right`, `toolbar`, `item-badges`, `footer`, `overlay`), ordered items, duplicate-id guard, per-todo host.
  - `src/ui/render.ts` — full app shell (composer, list, footer, overlay), event delegation, `todo:new` / `todo:clear-done` commands, `refresh()`/`destroy()`.
  - `src/ui/filters.ts` — `createFilterRegistry()` (ANDed view predicates) so search/tag chips never edit the renderer.
  - `src/lib/commands.ts` — namespaced command bus, duplicate registration throws.
  - `src/features/index.ts` — `import.meta.glob('./*/index.ts', { eager: true })` auto-discovery inside a `try/catch`, so new folders need **zero edits outside the folder**; `src/features/discover.node.ts` is the Bun-test twin.
  - `src/features/item-count/` — reference feature: one footer item + own CSS + tests.
  - `src/features/README.md` — slot/command/filter contract for agents working in a demo repo.
  - Seeded bugs in `src/lib/dates.ts` (untested on purpose): `isOverdue` compares the due instant with now and parses `YYYY-MM-DD` as UTC midnight; `sortByDue` compares `M/D/YYYY` strings and falls back to `createdAt` for undated todos.
- `examples/sky-todo/demo-goals/` — `launch-day` (7 tasks), `launch-day-xl` (10), `quick-wins` (3), `conflict-bait` (2, intentional `src/ui/render.ts` overlap), `will-fail-audit` (1); each with an `.expected.md` answer key (keys, lane globs, deps, DoD, disjointness argument).
- `examples/sky-todo/.starling-answers/BUGS.md` — repro + expected fix + regression cases for both bugs.
- `examples/scripts/make-demo-repo.sh` — copy → `git init -b main` → `bun install` → one commit, excludes answer keys; idempotent, refuses foreign non-empty dirs, bash 3.2, prints absolute path.
- `docs/epic-01-demo-target.md`.

**Key design decisions:**

- **Zero-edit feature registration via a literal `import.meta.glob` in a try/catch** — required by the prompt and verified in both Vite (bundle) and Bun (fs twin), since Bun has no glob. Alternative rejected: a checked-in registry file (shared edit point = conflicts).
- **Injected `Document` everywhere** (`mountApp(root)`, `ctx.doc`) — happy-dom tests need no globals and Bun never touches a DOM. Alternative rejected: `GlobalRegistrator` (global state, slower, leaks between files).
- **Filters and commands as registries** — search/tag/help/shortcuts can collaborate without importing each other or editing `render.ts`; lanes stay truly disjoint. Alternative rejected: features calling `document.querySelector` on each other's DOM.
- **Schema v2 with a v1 migration hook** — persistence is a real, testable seam (the prompt asked for a migration hook); unknown future versions are refused rather than mangled.
- **Bugs untested on purpose** — committed date tests assert only 2020/2099 for overdue and March-vs-September order, so the baseline is green and `dates-fix` has real work. Answer key holds the today/`10/2` cases.
- **Demo copies strip `.starling-answers/` and `*.expected.md`** — the answer must not be visible to coding agents in a demo repo.
- **Undated sort target = last** (answer key) — conventional and stable; the baseline's `createdAt` fallback is the bug.

**Verification (exact commands + results):**

- `cd examples/sky-todo && bun install` → `Checked 29 installs across 73 packages (no changes)`
- `bun test` → `71 pass / 0 fail — Ran 71 tests across 12 files`
- `bunx tsc --noEmit` → clean (strict + `noUncheckedIndexedAccess` + `noUnusedLocals`)
- `bun run build` → `✓ 16 modules transformed`, `dist/assets/index-*.js 10.71 kB` (gzip 4.30 kB), 200 ms
- Auto-discovery proof (throwaway, not committed): added `src/features/zz-test/index.ts` only → `bun test` 68 → **69 pass**, `dist` bundle `grep -c 'zz-test discovered'` = **1**; deleted the folder → **68 pass**, bundle count **0**, no other file touched.
- Seed-bug proof (throwaway script, deleted): `TZ=America/Toronto` → `isOverdue('2026-10-27', Oct 27 10:00 local) = true` (expected false), `sortByDue = oct-02, undated, sep-30` (expected sep-30, oct-02, undated). Same wrong order under `TZ=UTC`.
- `bash examples/scripts/make-demo-repo.sh /private/.../demo-final` → prints path; `git status --porcelain` **empty**; `rev-list --count HEAD` = **1**; `.starling-answers` absent; `demo-goals/*.expected.md` = 0; `bun test` there → **71 pass / 0 fail**. Re-running the same target replaced it and stayed at 1 clean commit; a foreign non-empty dir was refused (file preserved).
- `bash -n examples/scripts/make-demo-repo.sh` → ok.
- Root `bun run test` / `bun run check`: **not available on `origin/main` at rebase time** — Epic 00 has not landed the root `package.json` yet (origin/main is only orchestrator docs). Once it does, sky-todo stays out of the root run by design: it is not in `packages/*` or `apps/*`, and E00's root test/check scripts exclude `examples/`. No root files were touched.

**Dependencies added:** `vite@8.3.5`, `typescript@7.0.2`, `happy-dom@21.0.4`, `@types/node@26.6.5`, `@types/bun@1.3.11` in `examples/sky-todo` (outside the workspace; its own `bun.lock`).

**CONTRACT REQUESTS:** none.

**Deliberately deferred / out of scope:**

- No feature implementations from the demo goals (theme/search/export/shortcuts/help/due-dates/undo/stats/tags) — that is Starling's live work.
- No Starling packages, root config, CI, or browser E2E (happy-dom + a build-level glob check instead).
- No planner-vs-answer-key diff harness yet (E29/E37).
- `conflict-bait` resolver exercise and `will-fail-audit` verdict are answer keys only; they need the engine to run.

**Open questions / flagged tradeoffs:**

- `launch-day`'s `help-overlay` DAG edge points at `shortcuts` as the prompt specified. Technically help registers `help:open` and shortcuts calls it, so they could run in parallel (shortcuts degrades silently when a command is missing, which is tested). Kept the prompt's direction: help's DoD "press ? and it opens" needs shortcuts.
- Bun has no `import.meta.glob`; the committed discovery test exercises the fs twin, while Vite's glob is verified via the bundle. If Bun gains glob support later, the twin can be deleted.
- The root test/check scripts are unverified until E00 merges; if E00's `bun test` glob does not exclude `examples/`, it will pick up sky-todo's 71 tests (they pass, but they belong to the standalone project).
