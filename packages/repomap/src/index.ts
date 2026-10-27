/**
 * `@starling/repomap` — repo scanner → `RepoMap`.
 *
 * Public surface: `createRepoMapper` (the `RepoMapper` port), `renderRepoMap` (prompt rendering),
 * `renderTree` (the budgeted tree alone), plus the small detection helpers the planner and prompt
 * compiler may reuse. See `docs/epic-11-repomap.md`.
 */
export const PACKAGE = '@starling/repomap' as const;

export type { DetectedCommands } from './commands';
export { detectCommands } from './commands';
export { isLockfile, isSkippedPath, langForPath, SYMBOL_LANGUAGES } from './languages';
export type { RepoMapperOptions } from './mapper';
export { createRepoMapper } from './mapper';
export type { RenderRepoMapOptions } from './render';
export { DEFAULT_RENDER_MAX_TOKENS, renderRepoMap } from './render';
export { extractSymbols, SYMBOL_CAP } from './symbols';
export type { RenderTreeOptions } from './tree';
export { renderTree } from './tree';
