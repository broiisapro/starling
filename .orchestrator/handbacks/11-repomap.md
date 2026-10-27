## Epic 11 Handback — Repo mapper

**Status:** Complete. Branch `epic/11-repomap` @ `a10c324` (rebase on `origin/main` clean; no new upstream commits).

**Delivered:**
- `packages/repomap/src/mapper.ts` — `createRepoMapper({ exec?, llm?, cacheDir?, clock? })` implementing core's `RepoMapper`. Lists with `git ls-files -co --exclude-standard -z`, skips binaries (NUL sniff, first 8 KB), files > 256 KB, lockfiles, and generated/vendored dirs, reads 24 files in parallel, caps `maxFiles` (default 5,000).
- `packages/repomap/src/languages.ts` — extension + filename language detection for the requested families, `languages` file counts, lockfile/skip-path predicates.
- `packages/repomap/src/symbols.ts` — parser-free symbol extractors for TS/JS (exports, export lists, CJS, named/anonymous default handling), Python top-level defs/classes, Go funcs/methods/types, Rust `pub` items, top-level CSS classes (max 20), Markdown h1/h2; 40-symbol/file cap, source order.
- `packages/repomap/src/tree.ts` — `renderTree(files, { maxChars, root? })`; flat folders > 20 files always collapse to `dir/ (N files)`, nested folders collapse progressively as the budget shrinks, whole entries are truncated with an honest count, arrows/lines stay ≤ 160 chars.
- `packages/repomap/src/commands.ts` — `detectCommands(root, paths)` with documented precedence: package.json `scripts.test` (bun/pnpm/yarn/npm from the lockfile, Bun default) → pytest signals → Cargo → Go → Makefile `test:`; lint = `lint` → `check` → `typecheck`.
- `packages/repomap/src/summaries.ts` + `cache.ts` — up to 20 central files (incoming relative JS/TS imports ×10 + symbols×2 + size, tests demoted), 4 concurrent `llm.complete({ role: 'summarizer' })` calls, one-line answers, SHA-1 content cache in `<cacheDir>/summaries.json` (default `~/.starling/repomap-cache`), cache atomic write, no LLM/error → no summaries, never a failed map.
- `packages/repomap/src/render.ts` — `renderRepoMap(map, { maxTokens, focus? })`: header (root, languages, test, lint), tree, per-file symbols/summaries; focus globs expand matching files and compact the rest; enforces `tokens × 4` at line boundaries with a "N more files" tail.
- `packages/repomap/src/index.ts` — public exports; doc `docs/epic-11-repomap.md` with exact signatures + usage snippet.
- Tests: **66 pass / 0 fail** across 10 files, including polyglot symbol/language coverage, binary/large/lockfile/ignore/maxFiles cases, summary cache (second map = 0 LLM calls), failure tolerance, command precedence for all runners, a copied `examples/sky-todo` shape/symbols test, and a generated **2,000-file perf test**.

**Key design decisions:**
- **No parsers, no import graph** — regexes + relative-import counting keep the 2k-file map at ~0.25 s (2 s budget) and add zero dependencies; false negatives are acceptable because workers re-read files.
- **Git as the source of truth for file sets** — `.gitignore` and "untracked but new" semantics come for free; committed `node_modules`/`dist` are still filtered explicitly.
- **Absolute `RepoMap.root`** — unambiguous for the engine; fixture's relative root is a display concern only. `RepoFile.path` stays repo-relative, matching core's contract.
- **Tree collapse under budget pressure, plus large flat folders always** — a default collapse of every 20-file directory would hide `src/lib` in a small app; large flat folders (`src/components/`) are still summarized in one line.
- **Precedence, not merging, for commands** — one test command is what the auditor needs. A `package.json` without a test script falls through rather than guessing `npm test`.
- **Bun default when no lockfile** — Starling runs on Bun and `bun run <script>` also works in plain npm projects.
- **Content-keyed summary cache** — exactly as specified; a model change reuses old summaries by design (cheap; one cache wipe fixes it).

**Verification (exact commands + results):**
- `bun install`: `Checked 133 installs across 192 packages (no changes)` — clean.
- `bun test packages/repomap`: `66 pass, 0 fail, 190 expect() calls; Ran 66 tests across 10 files. [~0.8 s]`.
- Perf test (`packages/repomap/src/perf.test.ts`, 2,000 generated files): passes; whole file `[240.00ms]` against the 2,000 ms map budget.
- `bun run test` (root): `251 pass, 0 fail, 974 expect() calls; Ran 251 tests across 46 files. [977.00ms]`.
- `bun run check`: **fails only on pre-existing formatting errors outside this lane** — `bunx biome check .` reports `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/{host.ts,ollama.ts,ollama.test.ts,smoke.ts}` and two committed `tools/local-models/results/*.json` (all present on `origin/main`, untouched here). `bunx biome check packages apps` → `Checked 150 files … No fixes applied` (pass), `bun run typecheck` → exit 0, and `bunx biome check packages/repomap docs/epic-11-repomap.md` passes.
- Sky-todo check: 57 files, `{ typescript: 29, markdown: 13, text: 10, css: 2, json: 2, html: 1 }`, `testCommand: 'bun run test'`, `tokenEstimate: 1529`, dates.ts symbols include `formatIso`, `sortByDue`, `DateInput`.
- `git fetch origin && git rebase origin/main`: `Current branch epic/11-repomap is up to date.`

**Dependencies added:** none.

**CONTRACT REQUESTS:** none. `RepoMapper` is implemented verbatim; `renderRepoMap`/`renderTree` are additive public exports of `@starling/repomap`, which the planner (E12) and prompt compiler (E14) can import through the package index at C1. No handshake file was needed because this package talks only to core and to no sibling Wave 1 package.

**Deliberately deferred / out of scope:**
- Monorepo/workspace-aware command detection (only the root `package.json` is read).
- Real import-graph analysis, path-alias resolution, Go/Rust/Python module centrality; symbols + size are the fallback ranking.
- Exact tokenizer; `tokenEstimate`/`maxTokens` use chars ÷ 4 as specified.
- Live model tests; all summary tests use `MockLLM`, per L23.
- Tree-sitter, embeddings and semantic search (explicitly out of scope).

**Open questions / flagged tradeoffs:**
- Root `bun run check` is red on `origin/main` because of Epic 01/02 formatting; the integrator should run `bunx biome check --write tools docs` (or fix in those lanes). Nothing in `packages/` or `apps/` is red.
- `maxFiles` default 5,000 silently stops per-file detail on very large repos; the tree/languages/commands still reflect the filtered set. Raise it per call if a repo needs more.
- Flat directories with more than 20 files always collapse even when the budget is generous. Chosen to keep generated component folders from eating the tree; easy to tune if the planner wants more detail.
- CSS symbol extraction intentionally ignores indented (nested) selectors, so media-query rules contribute no class names.
- Summary centrality only counts relative JS/TS imports; a Python/Rust repo ranks by symbols and file size instead.

Closes #5
