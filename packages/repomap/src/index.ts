/**
 * `@starling/repomap` — repo scanner → `RepoMap`.
 *
 * Public surface: `createRepoMapper` (the `RepoMapper` port), `renderRepoMap` /
 * `renderRepoMapDetail` (prompt rendering, plain and lane-grouped), `renderTree` (the budgeted tree
 * alone), the relative-import graph helpers, plus the small detection helpers the planner and prompt
 * compiler may reuse. See `docs/epic-11-repomap.md` and `docs/epic-56-repomap-prompts.md`.
 */
export const PACKAGE = '@starling/repomap' as const;

export type { DetectedCommands } from './commands';
export { detectCommands, jsFileShare } from './commands';
export type { ImportGraph } from './imports';
export {
  attachImportGraph,
  buildImportGraph,
  importGraphOf,
  relatedFiles,
  resolveImportPath,
} from './imports';
export type { RelatedFilesOptions } from './imports';
export { isBinaryPath, isLockfile, isSkippedPath, langForPath, SYMBOL_LANGUAGES } from './languages';
export type { RepoMapperOptions } from './mapper';
export { createRepoMapper, samplePaths } from './mapper';
export type {
  RankedRepoFiles,
  RankRepoFilesOptions,
  RenderedRepoMap,
  RenderRepoMapOptions,
} from './render';
export { DEFAULT_RENDER_MAX_TOKENS, rankRepoFiles, renderRepoMap, renderRepoMapDetail } from './render';
export { extractSymbols, SYMBOL_CAP } from './symbols';
export type { RenderTreeOptions } from './tree';
export { renderTree } from './tree';
