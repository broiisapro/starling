# Epic 11 — Repo mapper

## Goal

Turn any git repository into a compact `RepoMap`: which files exist, what languages they are, the
exported symbols worth knowing about, a token-budgeted directory tree, and the commands that test and
lint it. The planner uses the map to choose lanes; the prompt compiler uses it to orient a worker.
It has to be fast (a 2,000-file repo in under two seconds), cheap (no parsers, no embeddings) and
safe to call on a repo Starling did not create.

## How it works

`createRepoMapper()` implements the `RepoMapper` port from `@starling/core`:

1. **List** with `git ls-files -co --exclude-standard -z` (tracked plus untracked-but-not-ignored,
   NUL-separated so paths with spaces survive). A non-git directory or a failed `git` call throws
   `StarlingError('REPOMAP_ERROR')`.
2. **Filter** lockfiles and generated/vendored paths (`node_modules`, `dist`, `.starling`, `build`,
   `target`, `.next`, `coverage`, virtualenvs, …). `maxFiles` (default 5,000) then takes the first
   paths in alphabetical order.
3. **Read** up to 24 files concurrently. A file is dropped if it is larger than 256 KB, if the first
   8 KB contains a NUL byte (binary), or if it cannot be read (deleted symlink, permissions).
4. **Classify** by extension (`languages.ts`) and extract **symbols** with line-anchored regexes
   (`symbols.ts`): TypeScript/JavaScript exports (functions, classes, consts, types, interfaces,
   enums, export lists, CommonJS), Python top-level `def`/`class`, Go `func`/`type`, Rust `pub`
   items, top-level CSS class selectors (max 20) and Markdown `#`/`##` headings. Files cap at 40
   symbols, kept in source order.
5. **Render the tree** (`tree.ts`) to at most 4,000 characters. Large flat folders always collapse to
   `src/components/ (42 files)`; everything else collapses progressively (depth and descendant caps)
   only when the budget demands it, then whole entries are truncated with an honest count.
6. **Detect commands** (`commands.ts`). Test precedence: `package.json` `scripts.test` (runner from
   the lockfile) → pytest signals → `Cargo.toml` → `go.mod` → `Makefile` `test:` target. Lint
   precedence: `scripts.lint` → `scripts.check` → `scripts.typecheck`. The runner is `bun` for
   `bun.lock`/`bun.lockb`, `pnpm` for `pnpm-lock.yaml`, `yarn` for `yarn.lock`, `npm` for
   `package-lock.json`, and Bun when no lockfile exists (Starling's runtime; `bun run <script>` also
   works in plain npm projects).
7. **Summarize** optionally (`summaries.ts`), only when `map(repo, { summarize: true })` is called and
   an `LLM` was injected. Centrality = incoming relative JS/TS imports × 10 + symbols × 2 + size;
   test files are demoted. Up to 20 files, four calls in flight, one-line answers, 4,000 characters
   of context per file. Summaries are cached by content SHA-1 in `<cacheDir>/summaries.json`, so an
   unchanged repo makes zero model calls on the next run. No LLM, a model error or a broken cache
   degrades to "no summary"; none of them fail the map.
8. **Size** `tokenEstimate` as `ceil(characters of the full renderRepoMap / 4)` and stamp `createdAt`
   from the injected `Clock`.

`RepoMap.files` is the only per-file truth; `map.tree` is a rendering of it. Consumers that need the
map at a smaller budget should call `renderRepoMap` rather than re-implementing truncation.

## Key decisions & reasoning

- **No parser, no import graph.** The assignment forbids tree-sitter; a real import graph would need
  one. Regex symbols plus relative-import counting are enough to rank files, and they keep the 2k-file
  test at ~0.25 s (budget 2 s). False negatives are acceptable; a worker re-reads the file anyway.
- **`git ls-files` instead of walking the filesystem.** Git already knows about `.gitignore`,
  submodules and tracked-deleted files. `-co --exclude-standard` is exactly the "tracked + new" set a
  worker sees, which is the set the planner should reason about.
- **Read bytes, sniff NUL, decode once.** We stat for the size cap and binary check, then read once
  and decode with the platform `TextDecoder`. No dependency, no double read.
- **Family languages.** `.tsx` is `typescript`, `.jsx` is `javascript`. The planner budgets by family;
  the exact extension is still in `RepoFile.path`. This also matches the shape of the fixture.
- **Tree collapses under pressure, not by default.** Collapsing every 20-file directory would hide
  `src/lib/` from a small app and make the tree useless. Large _flat_ folders always collapse (the
  `src/components/ (42 files)` case); nested ones collapse only as the budget tightens. This keeps
  small repos fully navigable and large repos readable.
- **Command detection is precedence-ordered, not merged.** Returning one test command is what the
  auditor needs. JS first, then Python, Rust, Go, Make. Each step only claims when its signal exists;
  a `package.json` with no test script falls through instead of guessing `npm test`.
- **`bun run test` for Bun, `pnpm test`/`yarn test`/`npm test` for the others.** Mirrors the
  assignment's runner mapping and the scripts people actually type.
- **Centrality counts only relative imports.** Resolving `@/lib/x` aliases or Go modules cheaply is
  not possible without config parsing; symbol count and size carry non-JS files. Documented below.
- **Cache keyed by content, not by model.** The assignment asks for SHA-1 content caching. It means a
  model switch reuses old summaries; that is a deliberate, cheap trade (one `rm` fixes it).
- **No `console.log`, no global state.** Every collaborator (`exec`, `llm`, `clock`) is injectable;
  the default cache directory follows the `~/.starling` convention from ARCHITECTURE L9.

## Interfaces for future epics

Public from `@starling/repomap` (implemented in `packages/repomap/src/index.ts`):

```ts
export const PACKAGE: '@starling/repomap';

export interface RepoMapperOptions {
  exec?: typeof exec;      // core exec, injectable for tests
  llm?: LLM;               // required only for summarize: true
  cacheDir?: string;       // default ~/.starling/repomap-cache
  clock?: Clock;           // default systemClock
}
export function createRepoMapper(options?: RepoMapperOptions): RepoMapper;
// RepoMapper.map(repoPath, opts?: { summarize?: boolean; maxFiles?: number }): Promise<RepoMap>

export interface RenderRepoMapOptions { maxTokens?: number; focus?: string[] }
export const DEFAULT_RENDER_MAX_TOKENS: 4000;
export function renderRepoMap(map: RepoMap, opts?: RenderRepoMapOptions): string;

export interface RenderTreeOptions { maxChars?: number; root?: string }
export function renderTree(
  files: readonly (string | Pick<RepoFile, 'path'>)[],
  opts?: RenderTreeOptions,
): string;

export function detectCommands(root: string, paths: readonly string[]): DetectedCommands;
export interface DetectedCommands { testCommand?: string; lintCommand?: string }

export function langForPath(path: string): string;
export function extractSymbols(source: string, lang: string): string[];
export const SYMBOL_CAP: number;             // 40
export const SYMBOL_LANGUAGES: ReadonlySet<string>;
export function isLockfile(path: string): boolean;
export function isSkippedPath(path: string): boolean;
```

Usage, as the planner (E12) and prompt compiler (E14) will wire it at C1:

```ts
import { createRepoMapper, renderRepoMap } from '@starling/repomap';
import type { Goal } from '@starling/core';

const mapper = createRepoMapper({ llm }); // llm optional
const map = await mapper.map(goal.repoPath, { summarize: true });
const briefing = renderRepoMap(map, { maxTokens: 2500 });
const laneBriefing = renderRepoMap(map, { maxTokens: 1200, focus: ['src/features/theme/**'] });
```

`renderRepoMap` never mutates the map, is deterministic for a fixed map and budget, and outputs at
most `maxTokens × 4` characters. It is safe to call per task.

## Deviations from plan

- **`RepoMap.root` is absolute.** The fixture stored `examples/sky-todo`; the mapper resolves the
  input path so a map is unambiguous regardless of the caller's cwd. Paths inside the map stay
  repo-relative.
- **`testCommand` for sky-todo is `bun run test`, not the fixture's `bun test`.** The assignment's
  runner mapping explicitly says `bun.lock → bun run test`, and the demo repo now has a `test`
  script. The fixture's shape (language set, detected command) is asserted; its literal command
  string is not.
- **Language families** collapse TSX/JSX/MJS into `typescript`/`javascript`; the fixture only used
  `.ts`, so its counts are a floor.
- **The sky-todo test copies and `git init`s the demo repo** instead of mapping it in place. Mapping
  in place would work, but tests must not write anything outside their lane and must not depend on
  the worktree's git state.
- **Extra skipped directories** (`build`, `target`, `.next`, `coverage`, virtualenvs, `vendor`-like
  caches) beyond the three the assignment named. Committed build output is noise in every prompt.
- **Lint detection is JS-only.** Rust/Clippy and Ruff are not guessed; a wrong lint command is worse
  than no lint command. `lintCommand` stays undefined there.
- **`maxFiles` defaults to 5,000.** The map still lists `languages` and commands for a larger repo,
  but per-file detail stops there to protect the prompt budget and memory.

## Known limitations / deferred

- Only the **root** `package.json` is inspected. Monorepo workspace scripts (turbo, Nx, pnpm `-r`)
  produce a plausible root command at best. A per-package detection pass belongs to a later epic if
  plans start targeting monorepos.
- Centrality counts only **relative JS/TS imports**. Python `from .x`, Go modules, Rust `mod` and TS
  path aliases do not contribute; symbols and file size are the fallback ranking there.
- Regex symbol extraction is approximate: decorated/exported-but-aliased declarations, JSX component
  defaults (`export default () => …`) and header-only Markdown are not representable. It never parses
  strings or comments, so a commented-out `export function` can appear.
- Binary detection is a NUL sniff, not a content-type check; a UTF-16 file (NULs everywhere) is
  treated as binary and a Latin-1 text file is included. Both are rare in source trees.
- The summary cache is content-keyed and last-writer-wins across processes. Concurrent Starling runs
  sharing `~/.starling` can overwrite each other's entries; the worst case is one extra model call.
- `renderRepoMap`'s budget is character-based (`×4`), not a real tokenizer. It is a guardrail, not an
  exact billing estimate.
- No import-aware "read these five files" packaging yet; `focus` globs are the only expansion knob.
  The prompt compiler can add its own task-specific selection at C1 without changing this package.
