# Epic 56 — Repo map + worker prompts on real-world repos

**Wave 2a · branch `epic/56-repomap-prompts` · package `@starling/repomap` + `@starling/prompts`**

## Goal

Wave 1 proved the mapper and the prompt compiler against `examples/sky-todo` — 18 files, one
language, one test runner. This epic points them at six real open-source checkouts of different
shapes and fixes what breaks: files that should never be read, commands that point at the wrong
suite, symbols that are prose or missing entirely, slow paths, and a worker prompt whose repo map
was 30 lines of noise around a 3-file lane.

Two deliverables live outside the packages:

- `packages/repomap/bench/real-repos.ts` — shallow-clones six public repos, maps each, prints the
  table (files, languages, symbols/file, detected test/lint, tokens, best-of-N time) and exits
  non-zero when a detected command disagrees with hand-checked ground truth.
- `packages/prompts/bench/real-prompts.ts` — for the same checkouts, writes a plausible `TaskSpec`
  whose lane exists in that repo, compiles the worker prompt and reports how focused the excerpt is.

Both are scripts, not tests: they need the network on first run. `bun test packages/repomap
packages/prompts` stays offline.

## How it works

### The bench

`BENCH_REPOS` pins one repo per shape, its commit, the command a maintainer actually runs, and the
evidence for that expectation (script, config section, harness):

| shape | repo | why this one |
| --- | --- | --- |
| TS monorepo (pnpm) | `changesets/changesets` | root `vitest`, workspace packages, a `CHANGELOG.md` per package |
| Python package (pytest) | `pallets/click` | `[tool.pytest.ini_options]`, `src/` layout |
| Go service | `gin-gonic/gin` | `go.mod` + a `Makefile` with test and lint targets |
| Rust crate (workspace) | `serde-rs/serde` | virtual `[workspace]` manifest, five members |
| Vite/React app tree | `alan2207/bulletproof-react` | three `apps/*`, each with its own `package.json` and `yarn.lock`, no root test script |
| ~5k files | `django/django` | 7,091 paths, 2,537 translation catalogues, a `tests/runtests.py` harness and a `package.json` that runs Grunt |

Clones are cached under `--dir` (default `<tmp>/starling-repomap-bench`), so the second run is
offline and measures the same commits. `--repeat N` maps each repo N times and reports the **best**
run: wall time on a box shared with ~23 agents is otherwise ±3× noise.

### What changed in `@starling/repomap`

**Listing and reading (`languages.ts`, `mapper.ts`).** Paths are filtered before anything is opened:
vendored and generated trees (`vendor/`, `third_party/`, `__generated__/`, `Pods/`, tool caches such
as `.turbo`, `.yarn`, `.gradle`), generated/minified/translated files (`*.generated.*`, `*.min.js`,
`*.pb.go`, `*.map`, `*.po`, `*.mo`) and binaries by extension (`.png`, `.woff2`, `.mo`, `.pdf`, …).
Files whose language has no symbol extractor are read at most 8 kB (enough to prove they are text);
symbol-bearing files are read once, in full. Above the file cap (now 8,000, was 5,000) the list is
**sampled evenly** instead of cut at the end of the alphabet.

**Symbols (`symbols.ts`).** Markdown headings are no longer symbols. Rust captures `pub` methods
inside `impl` blocks (they are the crate's API) plus private top-level items; Go captures package
vars and consts; TypeScript captures `export declare …` from `.d.ts` packages.

**Commands (`commands.ts`).** One precedence list, now with the cases real repos need: a
`package.json` script wins only when JS/TS is at least half the code files; declared workspaces get
the recursive runner; an app tree without a workspace declaration uses its biggest package; Python
task scripts (`pdm`/`poe`/`hatch`) and pytest configuration are read from `pyproject.toml`;
`tests/runtests.py` beats the generic pytest guess; a `[workspace]` `Cargo.toml` gets `--workspace`;
`justfile` joins `Makefile` for test **and** lint targets.

**Rendering and neighbours (`render.ts`, `imports.ts`).** `renderRepoMap` keeps its planner shape
(header, tree, score-sorted `Files (N):`) and gains a **lane mode**: editable → read → neighbours →
orientation, one line per detailed file, budget-aware with a reserved footer, and a per-directory
sample for the orientation tail. `renderRepoMapDetail` returns `{ text, filesShown, filesTotal,
truncated }` for callers that need to warn. Neighbours come from `relatedFiles(map, seeds)`:
importers first, then imports, then same-directory siblings **of the lane only**.

The mapper attaches the relative-import graph to the returned `RepoMap` in a `WeakMap`
(`attachImportGraph`/`importGraphOf`). `RepoMap` is LOCKED, and an import graph is a rendering hint,
not a contract: a map that came from a fixture or a recorded run simply has no graph and degrades to
path siblings. Python relative imports (`from .core import run`) are resolved too.

### What changed in `@starling/prompts`

The package no longer has its own repo-map renderer. `renderRepoMap(map, { lane, maxChars, style })`
is now an adapter over `renderRepoMapDetail`: it computes the lane's seeds, asks for neighbours
(limit 12, siblings only from owned files) and renders with `bytes: true`, six symbols per detailed
file, no tree and the worker budgets. `rankRepoFiles` keeps its published shape by delegating to the
repomap bucket classifier. The worker prompt's sections, order and budget guard are untouched.

The output diff is deliberate: files in the **orientation tail** no longer carry symbols or
summaries. On sky-todo that removes `src/lib/dates.ts · … · symbols: formatDueDate, isOverdue,
sortByDueDate — Date formatting…` from the tail. The lane, the read list and the neighbours keep
them. This is the same noise the real repos exposed (see below), one scale smaller.

## Key decisions & reasoning

- **Ground truth in the bench, not in a doc.** The expected command per repo is stored next to the
  evidence, and the script exits 1 on a mismatch. That is what turned "our detection is plausible"
  into "four of six repos were wrong". A test cannot do this offline.
- **Best-of-N timing.** The first benchmark run reported 20 ms for click and the next 228 ms for the
  same code: this laptop is shared. Repeat runs and take the minimum, and treat ±30% as noise.
- **Fix by evidence, not by suspicion.** Every rule added has a repo behind it: `vendor/` and
  `third_party/` from moby and Kubernetes-style trees, `.po`/`.mo` and `runtests.py` from Django,
  indented Rust methods from serde (0.7 → 3.1 symbols/file), Changelog headings from changesets
  (3.7 → 1.0 symbols/file, the drop *is* the fix), nested apps from bulletproof-react, `--workspace`
  from serde.
- **The dominant language, not the first config file, picks the suite.** Django's `package.json`
  holds a Grunt script for its JS widget tests; running `bun run test` there tests ~1% of the repo.
  The gate is a 50% JS/TS share of code files, computed from the same path list the map already has.
- **A hard budget cannot also guarantee "never hide an owned file" — so the caps moved.** The bench
  found a 57-file lane (`changesets/packages/cli/src/**`) losing 17 editable files to a 40-file cap.
  Owned is now capped at 60 (full) / 20 (compact), which clears a package-sized lane; beyond that the
  footer reports the omitted count rather than pretending.
- **A read file's siblings are not neighbours.** First cut ranked every seed's directory peers: a
  400-file tree answered "what is near the store?" with nine unrelated modules. Importers and imports
  are meaningful for any seed; sibling expansion is limited to files the lane owns.
- **The tail is sampled per directory.** With 30 tail slots and one feature folder holding 400 files,
  the old path-sorted tail was 30 modules of the same folder. One line per directory (only when the
  bucket is over its cap) shows the breadth of the tree instead.
- **The footer is reserved before the tail.** An honest "371 more files not shown" is the most
  important line in a truncated map; it used to be the first thing the budget cut.
- **WeakMap, not a contract change.** `RepoMap` is LOCKED and adding `imports` would ripple through
  zod, the store and every fixture. The sidecar keeps the graph in-process where the renderer needs
  it, and nothing serialises it.
- **One renderer.** Wave 1 had three (planner, prompts, repomap). Prompts now delegates; the planner
  keeps its own until it adopts this one (see FIX REQUESTS in the handback). Two implementations can
  drift, three definitely do.
- **Snapshots from synthetic checkouts, focus from the real ones.** Six repo shapes are generated in
  a temp dir, git-initialised, mapped by the real mapper and snapshotted (offline, stable, reviewable).
  The live clones are checked by the bench, because they need the network.
- **Python lint stays undeclared.** black, ruff, flake8 and isort all look alike from the outside, and
  `make lint`/`just lint` are explicit where they exist. A wrong lint command is worse than none.

## Interfaces for future epics

New or changed public surface (`packages/*/src/index.ts`):

```ts
// @starling/repomap
export interface RenderRepoMapOptions {
  maxTokens?: number; maxChars?: number;
  focus?: string[];            // globs expanded to symbols + summary
  related?: string[];          // neighbour paths/globs ranked after the focus
  lanes?: { owns: string[]; reads: string[] };   // switches to the grouped lane layout
  style?: 'full' | 'compact';
  tree?: boolean; bytes?: boolean; maxSymbols?: number;
  caps?: Partial<{ owned: number; read: number; related: number; other: number }>;
}
export interface RenderedRepoMap { text: string; filesShown: number; filesTotal: number; truncated: boolean }
export function renderRepoMapDetail(map: RepoMap, opts?: RenderRepoMapOptions): RenderedRepoMap;
export function renderRepoMap(map: RepoMap, opts?: RenderRepoMapOptions): string;  // .text, as before

export function rankRepoFiles(
  map: RepoMap,
  options?: { owns?: string[]; reads?: string[]; related?: string[] },
): { owned: RepoFile[]; read: RepoFile[]; related: RepoFile[]; other: RepoFile[] };

export interface ImportGraph {
  imports: ReadonlyMap<string, readonly string[]>;
  importers: ReadonlyMap<string, readonly string[]>;
}
export function buildImportGraph(files: { path: string; imports: readonly string[] }[]): ImportGraph;
export function attachImportGraph(map: RepoMap, graph: ImportGraph): void;
export function importGraphOf(map: RepoMap): ImportGraph | undefined;
export function relatedFiles(map: RepoMap, seeds: string[], opts?: {
  limit?: number; includeSiblings?: boolean; siblingSeeds?: readonly string[];
}): string[];
export function resolveImportPath(fromPath: string, specifier: string, known: ReadonlySet<string>): string | undefined;

export function samplePaths(sorted: readonly string[], maxFiles: number): string[];
export function isBinaryPath(path: string): boolean;
export function jsFileShare(paths: readonly string[]): number;   // 0..1, 1 when there is no code
```

Unchanged signatures with richer behaviour: `detectCommands(root, paths)`, `renderTree`,
`createRepoMapper`, `SYMBOL_LANGUAGES` (markdown removed), `isSkippedPath`.

```ts
// @starling/prompts — unchanged port; the adapter internals moved to repomap
export function renderRepoMap(map: RepoMap, options?: { lane?: Lane; maxChars?: number; style?: PromptStyle }): RenderedRepoMap;
export function rankRepoFiles(map: RepoMap, lane?: Lane): { owned: RepoFile[]; read: RepoFile[]; other: RepoFile[] };
```

The engine and the auditor need no change: `PromptCompiler.worker(ctx)` is still the only entry
point, still pure, still deterministic.

## Deviations from plan

- **The "~5k-file" slot is Django at 7,091 paths.** `webpack/webpack` is 22k and `TanStack/query`
  4.1k; Django is closer to 5k in character and, unlike a fourth TypeScript repo, it exposed the
  wrong-suite bug and four extra failure modes (translations, a Grunt `package.json`, a test harness,
  an alphabetically truncated map).
- **Default `maxFiles` 5,000 → 8,000.** Django cannot be mapped completely under 5,000; the cap still
  exists to bound work on 20k-file monorepos, now with even sampling.
- **The `bulletproof-react` lane picks `apps/nextjs-app`.** Three apps have a test script and similar
  file counts; the rule is "biggest nested package, ties by path". Any of the three is a correct
  command for the repo, and the bench asserts the one the rule chooses.
- **Prompt snapshots were regenerated.** The diff is exactly the orientation-tail change described
  above (`worker.test.ts.snap`, `compiler.test.ts.snap`: symbols and summaries removed from
  `Other files`), plus the six new shape snapshots.
- **`docs/epic-11-repomap.md` and `docs/epic-13-prompts.md` are now partly stale** (markdown symbols,
  the 5,000 cap, "the prompt package has its own renderer"). They are outside this epic's lane, so
  this doc is the correction rather than an edit there.
- **The `@starling/prompts` → `@starling/repomap` dependency** is a workspace link added to
  `packages/prompts/package.json`; `bun install` updated `bun.lock` (never hand-edited).

## Known limitations / deferred

- **Import edges exist for JS/TS and Python relative imports only.** Go (`import "mod/pkg"` needs
  `go.mod` root resolution) and Rust (`use crate::…` needs the crate root) fall back to lane-folder
  siblings, which is usually nothing: the bench shows 0 neighbours for gin and serde. Absolute Python
  imports (`from acme.core import x`) are unresolved for the same reason — the package root is
  unknowable without config parsing.
- **One test command.** A polyglot repo gets its dominant suite; the secondary one (Django's JS
  widget tests) is not surfaced. `PlanIssue`/`RepoMap` have one field for this.
- **No Python or Rust lint.** Explicit `Makefile`/`justfile` lint targets and JS scripts only.
- **Regex symbols.** JSX arrow components, aliased exports, multi-line Go receivers, unusual Rust
  formatting and generated-looking code that is not in a skipped path can still be missed or noisy.
  `SYMBOL_CAP` is 40, symbols keep source order.
- **Even sampling above 8,000 paths** keeps the tree representative but is not the whole repo; the
  map has no field to say "sampled", so a caller cannot tell.
- **`tokenEstimate` still renders the entire map** (193 ms of Django's 580 ms is that render). A
  closed-form estimate would be cheaper and less useful to debug.
- **A very large lane spends the whole map budget on its own files.** `changesets/packages/cli/src/**`
  (57 files) fills the 6k map with editable files and no neighbours; the task spec, lane and
  verification sections are still complete, and the footer does not pretend otherwise.
- **Timing is best-of-N on a loaded laptop**, good for direction, not for absolute claims.
