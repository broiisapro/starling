# Expected decomposition — will-fail-audit

**Goal (1 task).** A clean, well-scoped task whose natural first attempt is
"ship the feature, skip the tests". Used to show the auditor catching a miss and
the fix loop closing it on the second attempt.

## Task table

| # | key          | title                                  | depends on | lane owns                  |
| - | ------------ | -------------------------------------- | ---------- | -------------------------- |
| 1 | `csv-export` | CSV export with quoting tests          | —          | `src/features/export/**`   |

Expected validator output: **no issues**.

## Why the lane is disjoint

One new feature folder, discovered by the Vite glob. Nothing outside
`src/features/export/**` is written.

## The miss the auditor should catch

The goal says "with tests". A typical first attempt produces:

- `src/features/export/index.ts` with a working button and a serializer, and
- **no test file**.

Auditor checks that must fail:

1. `definition-of-done`: "tests for quoting and commas" — no
   `src/features/export/*.test.ts` exists.
2. `test-command`: `bun test` passes, but the new behaviour has zero coverage;
   the LLM verdict should say the deliverable's test requirement is unmet.

The fixer prompt must name the missing cases explicitly: a title containing a
comma, a title containing a double quote, a title containing a newline, and the
header row. Pass condition: at least those four cases exist and `bun test` is
green.

## Full DoD for the task

- Toolbar "Export CSV" button downloads `sky-todo-YYYY-MM-DD.csv`.
- Header: `id,title,done,createdAt,due,tags`.
- RFC 4180: fields containing `,`, `"` or a newline are wrapped in quotes and
  inner quotes are doubled; rows end with CRLF.
- `tags` joined with `;`; missing due date exports as an empty field.
- Colocated tests cover commas, quotes, newlines, the header and the empty list.
- `bun test` and `bunx tsc --noEmit` green.

## Expected demo beat

First audit: **fail** with `fixInstructions` mentioning the missing tests.
Second attempt: adds `src/features/export/index.test.ts`; audit **pass**; merge.
Budget one retry so the cost meter shows the retry cost.
