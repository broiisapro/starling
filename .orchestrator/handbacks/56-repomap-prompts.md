## Epic 56 Handback — Repo map + worker prompts on real-world repos

**Status:** Complete. Branch `epic/56-repomap-prompts` @ 8511771.

Closes #80.

**Delivered:**

- `packages/repomap/bench/real-repos.ts` — shallow-clones six public repos (changesets, click, gin, serde, bulletproof-react, django), pins the commit it measured, maps each, prints files/languages/symbols-per-file/detected test+lint/tokens/best-of-N ms, prints the hand-checked evidence per repo and exits 1 on any command mismatch. `--dir` caches clones (offline reruns), `--refresh`, `--only`, `--repeat`, `--json`.
- `packages/prompts/bench/real-prompts.ts` — for the same checkouts, writes a `TaskSpec` whose lane exists in the repo, compiles the worker prompt and reports lane files shown/total, neighbours, orientation-tail lines, excerpt characters and prompt tokens. Exits non-zero if a lane file is missing from the excerpt.
- `@starling/repomap`: path filtering before any read (`vendor/`, `third_party/`, `__generated__/`, `Pods/`, tool caches, `*.generated.*`, `*.min.*`, `*.pb.go`, `*.map`, `*.po`, `*.mo`, binaries by extension); head-only reads for languages without a symbol extractor; single full read for symbol-bearing files; even sampling above the (now 8,000) file cap; markdown headings no longer symbols; Rust `pub` methods inside `impl` + private top-level items; Go package vars/consts; TypeScript `export declare`; a full test/lint precedence rewrite; lane-first `renderRepoMapDetail` with a reserved footer and per-directory tail sampling; `relatedFiles` over a relative-import graph attached to the map in a `WeakMap`; Python relative imports resolved.
- `@starling/prompts`: the worker map is now rendered by `@starling/repomap` (its own renderer is deleted); `rankRepoFiles` delegates to the repomap classifier. Worker prompt sections, order and budget guard are unchanged.
- 7 regression tests for the path/reading fixes, 12 for command detection, 3 for symbols, 8 for the graph and `relatedFiles`, 8 for lane-mode rendering, 1 for the importer graph at mapper level, and 7 new prompt tests: six repo-shape snapshots plus a "large repo stays focused" assertion.

**Key design decisions:**

- **Bench with ground truth, not a doc.** Each repo stores the command maintainers actually run and the evidence (script, config, harness); the script fails on mismatch. That surfaced 4/6 wrong commands instead of "plausible".
- **Best-of-N timing.** The same code measured 20 ms and 228 ms for click on consecutive runs on this shared laptop. `--repeat N` reports the minimum; ±30% is noise, not a regression.
- **Dominant language decides between a tooling `package.json` and the real suite.** Django's `package.json` runs Grunt for its JS widget tests; running it would test ~1% of the repo. Gate: JS/TS share of code files ≥ 50%.
- **Owned-file cap raised to 60 (from 40).** The bench found a 57-file lane losing 17 editable files. A hard budget cannot both honour "never hide an owned file" and stay small, so the cap clears a package-sized lane and the footer reports the rest.
- **Neighbours are importers → imports → lane siblings.** Sibling expansion is limited to *owned* seeds: a read file's nine directory peers in a 400-file tree answered the wrong question. Import edges stay for all seeds.
- **Import graph in a `WeakMap` keyed by the map object.** `RepoMap` is LOCKED; a graph is a rendering hint. Fixtures and recorded maps simply have no graph and fall back to siblings.
- **One renderer.** Prompts delegates to repomap (three renderers were three sources of drift). The planner still has its own — see FIX REQUESTS.
- **The orientation tail is sampled one file per directory** (only when the bucket is over its cap), and the footer space is reserved before the tail, so an honest "N more files" never gets cut first.
- **Snapshots from generated checkouts.** Six shapes are written to a temp dir, `git init`-ed, mapped by the real mapper and snapshotted offline; the live clones are covered by the benches, which need the network.

**Verification (exact commands + results):**

- `bun install` in the worktree: clean (`bun install v1.4.4`, no changes after the workspace link).
- `bun test packages/repomap packages/prompts`: `222 pass / 0 fail`, `10 snapshots`.
- `bun run test` (root): packages `1414 pass / 4 skip / 0 fail` (`Ran 1418 tests across 164 files`), then `apps/web` `426 pass / 0 fail` (`Ran 426 tests across 39 files`).
- `bun run check`: `biome check .` clean (708 files) and `tsc --noEmit` for every workspace, no output.
- Real-repo bench, before (bench script committed on the untouched Wave-1 packages, same clone cache, `--repeat 5`, min ms):

```
| repo | shape | sha | paths→files | languages | sym/file | test | lint | tokens | ms |
|---|---|---|---|---|---|---|---|---|---|
| changesets | TS monorepo (pnpm) | b09779a | 341→327 | typescript 162, markdown 88, json 33, yaml 11 | 3.7 (202) | pnpm test ✓ | pnpm run lint ✓ | 7884 | 64 |
| click | Python package (pytest) | 2247b35 | 178→175 | python 91, markdown 42, text 15, toml 11 | 5.9 (122) | pytest ✓ | — ✓ | 5253 | 48 |
| gin | Go service | 0f09c3a | 130→129 | go 99, yaml 11, markdown 9, text 3 | 8.7 (106) | go test ./... ✓ | — ✗ | 4205 | 29 |
| serde | Rust crate (cargo workspace) | 0db9b3b | 361→359 | rust 208, markdown 12, text 12, toml 7 | 0.7 (68) | cargo test ✗ | — ✓ | 6467 | 33 |
| bulletproof-react | Vite/React app tree | 9506629 | 535→522 | typescript 422, javascript 25, text 18, markdown 17 | 1.7 (346) | — ✗ | — ✗ | 11679 | 43 |
| django | ~7k files (large Python) | e9cf067 | 7091→3730 | python 1369, text 712, html 199, javascript 96 | 1.3 (951) | bun run test ✗ | — ✗ | 65376 | 622 |

4 command mismatch(es): gin, serde, bulletproof-react, django
```

- Real-repo bench, after (same script, same cache, `--repeat 5`, exit 0):

```
| repo | shape | sha | paths→files | languages | sym/file | test | lint | tokens | ms |
|---|---|---|---|---|---|---|---|---|---|
| changesets | TS monorepo (pnpm) | b09779a | 341→327 | typescript 162, markdown 88, json 33, yaml 11 | 1 (120) | pnpm test ✓ | pnpm run lint ✓ | 5791 | 22 |
| click | Python package (pytest) | 2247b35 | 178→175 | python 91, markdown 42, text 15, toml 11 | 4.5 (83) | pytest ✓ | — ✓ | 4296 | 17 |
| gin | Go service | 0f09c3a | 130→128 | go 98, yaml 11, markdown 9, text 3 | 8.5 (97) | go test ./... ✓ | make lint ✓ | 4079 | 17 |
| serde | Rust crate (cargo workspace) | 0db9b3b | 361→359 | rust 208, markdown 12, text 12, toml 7 | 3.1 (208) | cargo test --workspace ✓ | — ✓ | 7804 | 28 |
| bulletproof-react | Vite/React app tree | 9506629 | 535→522 | typescript 422, javascript 25, text 18, markdown 17 | 1.6 (329) | yarn --cwd apps/nextjs-app test ✓ | yarn --cwd apps/nextjs-app lint ✓ | 11459 | 52 |
| django | ~7k files (large Python) | e9cf067 | 7091→4354 | python 2935, text 759, html 373, json 55 | 2.1 (2036) | python tests/runtests.py ✓ | — ✓ | 84369 | 395 |

All detected commands match the hand-checked ground truth.
```

Notes on the numbers: Django maps 2.1× more of the repo (all 2,935 Python files, not a 5,000-path alphabetical slice) and is still faster (622 → 395 ms); it now reads `tests/runtests.py`'s harness instead of Grunt. Serde's symbols/file went 0.7 → 3.1 because indented `pub fn` methods are now captured. Changesets' symbols/file went 3.7 → 1.0 because 40 Changelog headings per file are no longer counted as symbols — that drop is the fix. Bulletproof-react is 9 ms slower (nested-package scan) and 1 kB smaller. All twelve timings move ±30% between runs on this shared laptop.

- Worker-prompt focus on the same six checkouts (`bun packages/prompts/bench/real-prompts.ts --dir <cache>`):

```
| repo | lane files shown | neighbours | orientation tail | excerpt chars | prompt tokens | note |
|---|---|---|---|---|---|---|
| changesets | 57/57 | 0 | 0 | 6090 | 2369 | truncated |
| click | 3/3 | 12 | 26 | 3572 | 1734 | truncated |
| gin | 31/31 | 0 | 15 | 4582 | 1980 | truncated |
| serde | 5/5 | 0 | 30 | 2525 | 1474 | truncated |
| bulletproof-react | 11/11 | 1 | 30 | 4382 | 1970 | truncated |
| django | 11/11 | 0 | 30 | 3259 | 1674 | truncated |

Every lane file appears in the excerpt.
```

`truncated` means the orientation tail is capped (honest footer), not that lane material is missing. The 57-file changesets lane is the one case where lane files alone consume the whole 6k map budget.

- Prompt snapshots: sky-todo's worker and compact snapshots were regenerated deliberately; the only diff is the orientation tail losing symbols/summaries (`src/lib/dates.ts` etc.), which is the intended focus change. Six new snapshots cover the repo shapes.

**Dependencies added:** none new. `"@starling/repomap": "workspace:*"` added to `packages/prompts/package.json`; `bun.lock` updated by `bun install` (not hand-edited).

**CONTRACT REQUESTS:** none. The import graph is a `WeakMap` sidecar rather than a new `RepoMap` field — `RepoMap` is LOCKED and serialised through zod/store/fixtures, and a rendering hint does not justify that ripple.

**FIX REQUESTS (lanes I do not own):**

1. `packages/planner/src/render-map.ts` (Epic 48) — the planner still renders its own repo map (`renderRepoMap` with `maxFiles`/`maxSymbols`/`summaryChars`). That is now the third-and-last duplicate; `@starling/repomap`'s `renderRepoMap(map, { maxTokens, maxFiles?… })` covers it. Please adopt it when the planner lane next changes, so the planner and the worker see the same file lines.
2. `docs/epic-11-repomap.md` and `docs/epic-13-prompts.md` — stale in three places (markdown heading symbols, `maxFiles` 5,000 and "the prompt package has its own minimal renderer"). The orchestrator owns cross-epic docs; corrections are in `docs/epic-56-repomap-prompts.md`.

**Deliberately deferred / out of scope:**

- Go (`go.mod`-relative) and Rust (`crate::`) imports, and absolute Python imports; the import graph is JS/TS + Python-relative only. Neighbours for gin/serde therefore come from siblings (usually none).
- Python/Rust lint detection (black/ruff/flake8/isort are indistinguishable without running them).
- More than one test command per repo; polyglot secondary suites stay invisible.
- A cheaper `tokenEstimate` (still renders the whole map; 193 ms of Django's 580 ms).
- Any LLM call, the planner (Epic 48) and the resolver prompt (Epic 45), per the assignment.

**Open questions / flagged tradeoffs:**

- The worker map excludes `map.tree` on purpose (budget for lane + neighbours). For a repo shape where the tree is the most useful orientation (unfamiliar monorepos), a compact `dir/ (N files)` line might beat 30 sampled paths — needs a prompt-quality eval with a real model, which this epic could not run (L23/no real calls).
- 60 owned files at ~90 characters each is the entire map budget. A planner that emits package-wide lanes will produce prompts where neighbours and orientation silently disappear (footer says so). Worth a `PlanIssue` warning above ~40 owned files in the planner lane.
- The nested-package rule picks by file count, so `bulletproof-react` resolves to `apps/nextjs-app` rather than the Vite app in `apps/react-vite`. Any of the three is a correct command; a human would pick by the goal. Left deterministic and documented.
