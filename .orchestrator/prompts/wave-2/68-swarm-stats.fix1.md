# Epic 68 · Fix 1: locale-independent timestamp formatting

**Same branch `epic/68-swarm-stats`, same worktree, same PR. Budget: 10 min.**

`apps/web/src/features/about/about-pure.test.ts` fails on Linux (it'll fail in CI too):
`formatTimestamp('2026-10-27T15:18:16Z')` returns `"27 Oct, 15:18 UTC"` there, while the test expects `"27 Oct at 15:18 UTC"`. `Intl` output differs across ICU versions and OSes.

1. Rewrite `formatTimestamp` (and any other `Intl`/`toLocale*` formatting in `features/about` and `tools/stats`) to build the string by hand from UTC parts (`getUTCDate`, a month-name array, zero-padded `getUTCHours`/`getUTCMinutes`), so the output is identical everywhere: `27 Oct at 15:18 UTC`.
2. Add a test that runs the formatter under two different `TZ` values (spawn `bun test` with `TZ=UTC` and `TZ=America/Toronto` from a small helper, or assert that the function ignores local time) to prove it's deterministic.
3. `cd apps/web && bun test` → 0 fail. Commit and push to the same PR. Print the PR URL last.
