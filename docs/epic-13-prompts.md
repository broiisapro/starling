# Epic 13 — Prompt compiler

**Wave 1 · branch `epic/13-prompts` · issue #7 · package `@starling/prompts`**

## Goal

Write what every worker agent reads. Starling's own build process — one prompt file per epic, one
agent per file, one lane per agent — is the methodology this package productises: a prompt that is
self-contained, lane-strict, explicit about the finish line, and short enough for a fast model to
read in one pass.

`createPromptCompiler()` returns the `PromptCompiler` port (ARCHITECTURE §6): `worker`, `fixer`
and `resolver`. It also ships the other half of the loop, `parseHandback()`, so the engine can read
the machine-readable block every agent finishes with (ARCHITECTURE §8).

Everything is pure and deterministic. No clock, no randomness, no network, no LLM.

## How it works

### Module layout

| file                 | responsibility                                                                 |
| -------------------- | ------------------------------------------------------------------------------ |
| `handshake.ts`       | §8 `WorkerHandback` mirror + zod schema + the two markers                      |
| `handback.ts`        | `parseHandback()` (last block, fence-tolerant) and the shared finish-line text |
| `options.ts`         | `PromptCompilerOptions`, defaults, validation (`INVALID_ARGUMENT`)             |
| `repo-map.ts`        | lane-focused map ranking + a small budgeted renderer                           |
| `sections.ts`        | reusable prompt sections (role, context, task, lane, siblings, verify, git)    |
| `worker-prompt.ts`   | assembles the worker prompt and runs the budget guard                          |
| `fixer-prompt.ts`    | failed checks, lane violations, verbatim fix instructions, same-lane rules     |
| `resolver-prompt.ts` | conflicted files, both intents, both-sides-survive rules                       |
| `compiler.ts`        | `createPromptCompiler()` — resolves options once, returns the port             |
| `testing/context.ts` | fixture-backed `PromptContext`/verdict/conflict builders used by the tests     |

### Worker prompt, in order

1. **Role** — “You are one of N agents working in parallel”, the branch, “do not switch branches”,
   and the autonomy rule: nobody is watching, so decide and finish.
2. **Project context** — goal text, plan summary, repo/test/lint, every `lockedDecisions` entry,
   and the goal's `constraints`.
3. **Your task** — title, goal, deliverables as checkboxes, out-of-scope, the definition of done
   numbered, and a dependencies line (“`dates-fix` is already merged into your branch”).
4. **Your lane** — the `owns` globs (“you may create or modify **only** files matching these”),
   the `reads`, and how violations are caught: the auditor diffs the branch against the integration
   branch and fails the task for any file outside the lane.
5. **What the others are doing** — one line per sibling with its lane, so nobody duplicates work
   or wanders into a sibling's files. Shrinkable under budget pressure.
6. **Repo orientation** — the repo map ranked and rendered for this lane: editable files first,
   then files it will read, then everything else as orientation. Budgeted.
7. **How to verify** — the effective `testCommand` and the DoD repeated as the checklist Starling
   will use, plus “prefer a real check to a claim”.
8. **Git rules** — Conventional Commits scoped to the task key, commit often, no push/merge/rebase,
   never touch `main`; Starling does integration.
9. **Finish line** — the exact `<<<STARLING_HANDBACK … STARLING_HANDBACK>>>` block, field by field.

### Fixer prompt

Sent to the same session and worktree after a failed audit. It leads with the verdict: failed
checks with the auditor's `detail`, the checks that already passed, the audit summary, and lane
violations (with “revert these before you continue”). Then `fixInstructions` verbatim, the rules
(“fix only this, don't redo completed work, the same lane rules apply”), the task for reference,
the lane again, and the same handback.

### Resolver prompt

Sent when the merge queue reports a conflict. `MergeResult` names the conflicted files but not the
other task, so the compiler attributes the conflict itself: every sibling whose `lane.owns` matches
a conflicted file supplies “the other side”. The prompt carries both intents (goal, deliverables,
out-of-scope; DoD for its own task), then the rules that stop a model from resolving by deletion:
preserve both behaviours, never drop either side's tests, resolve markers in place, run the tests,
commit the resolution on the same branch. When no lane claims the file, it says so and lists the
plan's lanes instead of inventing an owner.

### The budget guard

Defaults: `maxChars` 24 000 (≈6k tokens), `maxRepoMapChars` 6 000. If a worker prompt is over
budget, the compiler halves the repo-map budget down to 400 characters first; only when the map is
at its floor does it halve the sibling list, never below three siblings plus “and N more”. The task
spec, the lane globs, the verification section and the handback are never touched. If even the
minimum does not fit, the prompt is returned long: an incomplete task spec is worse than a long
prompt. The loop is capped at 12 steps and the shrink order is exactly the assignment's.

`style: 'compact'` keeps every fact and drops the prose around it (and spends 40% of the map
budget). It is the same compiler, not a second template.

### Parsing the handback

`parseHandback(text)` finds the **last** opening marker, then the closing marker after it, and
parses what is between. It tolerates a fenced body, a fence wrapped around the markers, prose
before and after, and extra JSON fields (zod strips them). Malformed JSON, a missing marker, a
missing closing marker or a wrong field type returns `undefined` — never a throw. The example block
in the prompt uses `<complete|partial>` and `<paths>` placeholders, so an agent that echoes the
template without editing it does **not** parse as a finished handback.

## Key decisions & reasoning

- **Facts before prose, and the task before the repo.** The model may stop reading; the deliverables,
  DoD and lane are above the repo map, which is the only section that is allowed to shrink.
- **The buddy check is the lane check.** Rather than asking the model to be careful, the lane
  section states the mechanism: a diff against the integration branch, an audit that fails on any
  file outside the globs, and an explicit escape hatch (“describe the change in your handback”).
- **Owned and read files are never dropped from the map.** Hiding a file the agent is allowed to
  edit is a correctness risk; truncating orientation noise is not. Only the “other files” tail is
  trimmed, and the footer says how many were hidden.
- **Ranking by lane globs, not by language or recency.** It is deterministic, needs no heuristics,
  and answers the only question a worker has at the start: which files may I touch, which will I
  read?
- **The template is deliberately not a valid handback.** A concrete example with
  `"status":"complete"` parses as a success if the agent copies it. `<complete|partial>` cannot pass
  the zod enum, so a lazy echo degrades to “no handback”, which the engine can treat as partial.
- **`undefined` instead of throwing on parse failure.** A malformed handback is an ordinary,
  expected model failure. The engine should keep the audit result, not crash the run. Wrong-task
  inputs, by contrast, are programmer errors and throw `StarlingError('INVALID_ARGUMENT')`.
- **Resolver attribution lives here, not in the merger.** `MergeResult` (LOCKED) has no field for
  “the other task”. Deriving it from lane globs uses data the plan already has and needs no contract
  change; the fallback is honest about not knowing.
- **Plain `<` string sorting, not `localeCompare`.** Snapshots must not depend on the machine's
  locale. Same reason `formatBytes` uses `toFixed`: deterministic bytes in, identical prompt out.
- **Compact style is a flag on one compiler.** Two template files would drift. The flag changes
  prose and the map share only; facts and section order are identical, which the tests assert.
- **The handback schema is mirrored, not imported from core.** ARCHITECTURE §8 says mirrors live in
  `src/handshake.ts` until C1, and `@starling/core` does not own `WorkerHandback` yet. The zod
  schema sits beside the interface so the two cannot drift.

## Interfaces for future epics

Everything below is exported from `@starling/prompts` (`src/index.ts`). `PromptContext`,
`AuditVerdict`, `MergeResult`, `Plan`, `TaskSpec`, `RepoMap` and `Lane` are the LOCKED core types.

```ts
export const PACKAGE: '@starling/prompts';

export type PromptStyle = 'full' | 'compact';

export interface PromptCompilerOptions {
  maxRepoMapChars?: number; // default 6_000
  style?: PromptStyle; // default 'full'
  maxChars?: number; // default 24_000
}

export interface ResolvedPromptOptions {
  maxRepoMapChars: number;
  maxChars: number;
  style: PromptStyle;
  mapShare: number; // 1 for 'full', 0.4 for 'compact'
}

export const DEFAULT_MAX_CHARS: number; // 24_000
export const DEFAULT_MAX_REPO_MAP_CHARS: number; // 6_000
export function resolveOptions(options?: PromptCompilerOptions): ResolvedPromptOptions;

export function createPromptCompiler(options?: PromptCompilerOptions): PromptCompiler; // core port
export function buildWorkerPrompt(ctx: PromptContext, options: ResolvedPromptOptions): string;
export function buildFixerPrompt(
  ctx: PromptContext,
  verdict: AuditVerdict,
  options: ResolvedPromptOptions,
): string;
export function buildResolverPrompt(
  ctx: PromptContext,
  conflict: MergeResult,
  options: ResolvedPromptOptions,
): string;
export function conflictingTasks(
  plan: Plan,
  taskKey: string,
  conflictedFiles: string[],
): TaskSpec[];

export interface WorkerHandback {
  status: 'complete' | 'partial';
  summary: string;
  filesChanged: string[];
  testsAdded: string[];
  notes?: string;
}
export const WorkerHandbackSchema: z.ZodType<WorkerHandback>;
export const HANDBACK_START = '<<<STARLING_HANDBACK';
export const HANDBACK_END = 'STARLING_HANDBACK>>>';
export function parseHandback(text: string): WorkerHandback | undefined;
export function handbackInstructions(): string;

export function estimateTokens(text: string): number; // ceil(chars / 4)

export interface RankedRepoFiles {
  owned: RepoFile[];
  read: RepoFile[];
  other: RepoFile[];
}
export interface RenderRepoMapOptions {
  lane?: Lane;
  maxChars?: number;
  style?: PromptStyle;
}
export interface RenderedRepoMap {
  text: string;
  filesShown: number;
  filesTotal: number;
  truncated: boolean;
}
export function rankRepoFiles(map: RepoMap, lane?: Lane): RankedRepoFiles;
export function renderRepoMap(map: RepoMap, options?: RenderRepoMapOptions): RenderedRepoMap;
```

Usage — the engine wiring this epic unblocks:

```ts
import type { PromptContext } from '@starling/core';
import { createPromptCompiler, estimateTokens, parseHandback } from '@starling/prompts';

const compiler = createPromptCompiler({ maxChars: 20_000 });

// On dispatch and on every retry:
const prompt = compiler.worker(ctx);
const tokens = estimateTokens(prompt); // budget/log only; not billing

// On a failed audit, same session and worktree:
const retry = compiler.fixer(ctx, verdict);

// On a merge conflict, same session:
const resolution = compiler.resolver(ctx, conflict);

// When the session goes idle, from its final text:
const handback = parseHandback(finalMessage);
if (handback?.status === 'partial') {
  // surface handback.notes next to the audit verdict
}
```

### For the engine (E20)

- Create one compiler at start-up and reuse it; it is stateless.
- Use `parseHandback` on the session's accumulated text. A `undefined` result means “no usable
  handback” — keep the run going and let the audit decide, rather than failing the task on it.
- `buildFixerPrompt`/`buildResolverPrompt` throw `INVALID_ARGUMENT` when the verdict/merge result
  belongs to another task. That catches engine bookkeeping bugs before they reach the wrong worktree.

### For the web (E23–E27)

Prompts are plain strings; the agent drawer can show them verbatim. No new contract is needed.

## Deviations from plan

- **`maxChars` is an option on `createPromptCompiler`.** The assignment's signature listed only
  `maxRepoMapChars` and `style`, but also required a `maxChars` budget guard (default 24k). Adding it
  to the options object was the smallest compatible way to make the guard configurable.
- **The worker prompt carries three extras beyond the listed sections**: goal `constraints` (they
  are repo-wide rules a worker must not break), an explicit dependencies line, and the lint command
  in the context header. All are facts the plan already has; none change the section order.
- **The resolver does not repeat the full task section.** Its own-intent block already carries the
  goal, deliverables, out-of-scope and DoD; repeating them verbatim was noise in a prompt whose job
  is to be read carefully under pressure.
- **Builders and helpers are public** (`buildWorkerPrompt`, `renderRepoMap`, `estimateTokens`, …)
  even though the port only needs the factory. The engine and tests both benefit from composing
  sections directly, and keeping them private would have made the snapshot tests reach into
  internals.
- **`packages/prompts/src/testing/context.ts`** is a fixture loader for tests, deliberately not
  exported from the package root.

## Known limitations / deferred

- `estimateTokens` is a 4-characters-per-token heuristic. It is a budgeting aid, not a tokenizer.
- The repo-map renderer is intentionally minimal: no tree, no symbol extraction, no caching. The
  repomap epic's renderer is adopted at checkpoint C1; this one is not meant to survive forever.
- Budget pressure can leave a prompt over `maxChars` when the fixed sections alone exceed it. The
  task spec is never truncated by design; the loop returns the long prompt after 12 shrink steps.
- Sibling trimming is deterministic but blunt: the last siblings in plan order disappear first, so a
  task that matters could be listed as “and N more”. At three siblings left, the footer still names
  the count and says their lanes are off-limits.
- The parser does not verify that `filesChanged` matches the real diff, nor that `testsAdded` exists.
  That is the auditor's job; the handback is a claim, not evidence.
- Prompt quality against a live model is untested here: L23 forbids real LLM calls in this wave.
  There are no `*.live.test.ts` files because there is nothing live to call.
- The `worker` prompt does not include the previous attempt's diff on a retry — that is the fixer's
  job. A first attempt always starts from the integration branch.

## Appendix — the full worker prompt for `csv-export`

Generated by `createPromptCompiler().worker(skyTodoContext('csv-export'))` from
`fixtures/plans/sky-todo-launch-day.json` and `fixtures/repomaps/sky-todo.json` (6,348 characters,
≈1,587 tokens by the heuristic above), reproduced verbatim for tone review.

```
# Starling worker — csv-export

You are one of 7 agents working in parallel on one goal. Each agent owns a lane of files and runs in its own git worktree. Nobody reviews your work in real time: investigate, decide, write down why, and finish. Do not stop to ask questions.

Branch: `starling/9w0x1y/csv-export` — already created and checked out. Do not switch branches.

## Project context

**Goal:** Add dark mode with a toggle, live search filtering, CSV export, keyboard shortcuts (n = new, / = search, ? = help), due-date badges, and fix the overdue-calculation and date-sorting bugs in src/lib/dates.ts.

**Plan:** Seven lane-disjoint tasks: five new features plus the two date bugs, with due-date badges gated on the date fix and the help overlay gated on shortcuts.

**Repo:** `examples/sky-todo` · tests: `bun test` · lint: `bunx biome check .`

**Locked decisions — repo-wide, do not relitigate:**

- Vanilla TypeScript + Vite, no UI framework
- Tests live beside their sources and run with bun test
- Feature folders under src/features/<feature>/ own their code; shared UI lives in src/ui
- localStorage is the only persistence layer

**Constraints from the goal:**

- Do not add runtime dependencies
- Keep the bundle vanilla TypeScript

## Your task: CSV export

Export the current todo list as a CSV download with a proper header row and escaped fields.

**Deliverables**

- [ ] src/features/export/index.ts exports exportCsv(todos) and initExportButton()
- [ ] Fields containing commas or quotes are escaped
- [ ] Downloaded filename is sky-todo-YYYY-MM-DD.csv

**Out of scope — do not do these**

- Importing CSV

**Definition of done — Starling checks every item**

1. bun test passes
2. A round-trip test covers commas, quotes and newlines
3. The button is disabled when the list is empty

**Dependencies:** none — you start from the integration branch, so your work must stand on its own.

## Your lane

You may create or modify **only** files matching these globs:

- `src/features/export/**`

You may read anything, but these are the files that matter:

- `src/store/todos.ts`
- `src/main.ts`

**Lane violations fail the audit.** When you go idle Starling diffs your branch against the integration branch. Any changed file outside these globs is a lane violation and fails the audit — including a "one-line fix" in a sibling's file. If you genuinely need a change outside your lane, describe it in your handback notes instead of making it.

## What the others are doing

6 other agents are working in parallel right now. Their lanes are off-limits: do not edit their files, and do not duplicate their work.

- `theme` — Dark mode with a toggle · owns `src/features/theme/**`, `src/ui/styles.css`
- `search` — Live search filtering · owns `src/features/search/**`
- `shortcuts` — Keyboard shortcuts · owns `src/features/shortcuts/**`
- `due-badges` — Due-date badges · owns `src/features/due-dates/**`
- `dates-fix` — Fix overdue calculation and date sorting · owns `src/lib/dates.ts`, `src/lib/dates.test.ts`
- `help-overlay` — Help overlay · owns `src/features/help/**`

## Repo orientation

A snapshot, not the source of truth: read a file before you edit it.

Repo: examples/sky-todo · 18 files · typescript 13, json 2, css 1, html 1
Tools: test `bun test` · lint `bunx biome check .`

In your lane (editable):
- src/features/export/index.ts · typescript · 24 B

You will read:
- src/main.ts · typescript · 1.2 kB · symbols: mount, handleSubmit — Creates the store, wires the form and renders the list.
- src/store/todos.ts · typescript · 1.6 kB · symbols: createTodoStore, addTodo, toggleTodo, removeTodo, setQuery, visibleTodos — In-memory todo store with a tiny subscribe API.

Other files (orientation only):
- index.html · html · 512 B
- package.json · json · 288 B
- src/features/due-dates/index.ts · typescript · 24 B
- src/features/search/index.ts · typescript · 24 B
- src/features/shortcuts/index.ts · typescript · 24 B
- src/features/theme/index.ts · typescript · 24 B
- src/lib/dates.test.ts · typescript · 940 B — Tests for date helpers.
- src/lib/dates.ts · typescript · 860 B · symbols: formatDueDate, isOverdue, sortByDueDate — Date formatting, overdue check and due-date sorting helpers.
- src/lib/ids.test.ts · typescript · 360 B
- src/lib/ids.ts · typescript · 410 B · symbols: newTodoId
- src/store/persist.ts · typescript · 620 B · symbols: loadTodos, saveTodos — localStorage persistence with schema validation.
- src/store/todos.test.ts · typescript · 1.2 kB
- src/ui/render.ts · typescript · 1.4 kB · symbols: render, renderItem — Renders the todo list and applies due-date badges.
- src/ui/styles.css · css · 980 B
- tsconfig.json · json · 340 B

## How to verify

Run `bun test` from the repo root before you finish. It must pass; a green suite is the difference between merged and failed.

Starling will check the definition of done item by item:

1. bun test passes
2. A round-trip test covers commas, quotes and newlines
3. The button is disabled when the list is empty

Prefer a real check to a claim: when an item describes behaviour, add or extend a test that fails without your change.

## Git rules

- Commit on `starling/9w0x1y/csv-export` with Conventional Commits: `feat(csv-export): …`, `fix(csv-export): …`, `test(csv-export): …`.
- Commit small and often, and leave the working tree clean when you finish.
- Do not push, merge, rebase or switch branches, and never touch `main`. Starling handles integration.
- Never commit secrets, `.env`, `node_modules` or build output.

## Finish line

End your final message with exactly this block. Starling parses it; a missing or unparseable block counts as a partial result:

<<<STARLING_HANDBACK
{"status":"<complete|partial>","summary":"<one line>","filesChanged":["<paths>"],"testsAdded":["<test files>"],"notes":"<optional>"}
STARLING_HANDBACK>>>

- Replace every `<…>` placeholder. The template is an example, not a valid handback.
- `status` is `"complete"` only when every definition-of-done item is met; otherwise use `"partial"`.
- `filesChanged` lists every file you changed; `testsAdded` lists every test file you added or extended.
- Keep `summary` to one line. Valid JSON only: no comments, no trailing commas. No fence is needed.
```
