/**
 * The worker's view of the repo map: lane first, neighbours second, everything else as orientation.
 *
 * The rendering itself lives in `@starling/repomap` (`renderRepoMapDetail`) — one renderer, one set
 * of budget rules, and the same file lines the planner sees. This module is the adapter that knows
 * what a lane means: which files may be edited, which will be read, and which neighbours (importers,
 * imports, same-directory files) are worth spending prompt characters on.
 *
 * Owned and read files are never dropped for budget reasons — hiding a file the agent is allowed to
 * edit is worse than a slightly long prompt.
 */
import type { Lane, RepoFile, RepoMap } from '@starling/core';
import { matchesAny } from '@starling/core';
import { rankRepoFiles as rankFiles, relatedFiles, renderRepoMapDetail } from '@starling/repomap';
import { DEFAULT_MAX_REPO_MAP_CHARS, type PromptStyle } from './options';

export interface RankedRepoFiles {
  /** Files matching a lane `owns` glob: editable. */
  owned: RepoFile[];
  /** Files matching a lane `reads` glob: read-only orientation. */
  read: RepoFile[];
  /** Everything else in the map. */
  other: RepoFile[];
}

export interface RenderRepoMapOptions {
  lane?: Lane;
  /** Character budget for the whole block. Defaults to `DEFAULT_MAX_REPO_MAP_CHARS`. */
  maxChars?: number;
  style?: PromptStyle;
}

export interface RenderedRepoMap {
  text: string;
  filesShown: number;
  filesTotal: number;
  /** True when at least one file was hidden or the text was clamped. */
  truncated: boolean;
}

/** Symbols shown per detailed file: enough to recognise the API, not a signature dump. */
const MAX_SYMBOLS = 6;

/** Neighbours are a hint, not a second lane: this is the most that can be worth the characters. */
const RELATED_LIMIT = 12;

/**
 * Split the map into editable / read / other, each sorted by path so output is deterministic.
 *
 * The neighbour bucket is deliberately folded into `other`: this function is the lane classifier,
 * and `renderRepoMap` is what decides where neighbours rank.
 */
export function rankRepoFiles(map: RepoMap, lane?: Lane): RankedRepoFiles {
  const ranked = rankFiles(map, { owns: lane?.owns ?? [], reads: lane?.reads ?? [] });
  return { owned: ranked.owned, read: ranked.read, other: ranked.other };
}

/**
 * Render the map as compact orientation text. Deterministic: same map in, same string out.
 */
export function renderRepoMap(map: RepoMap, options: RenderRepoMapOptions = {}): RenderedRepoMap {
  const lane = options.lane;
  const seeds =
    lane === undefined
      ? []
      : map.files
          .filter((file) => matchesAny(file.path, [...lane.owns, ...lane.reads]))
          .map((file) => file.path);
  const owned =
    lane === undefined ? [] : map.files.filter((file) => matchesAny(file.path, lane.owns)).map((file) => file.path);

  return renderRepoMapDetail(map, {
    maxChars: options.maxChars ?? DEFAULT_MAX_REPO_MAP_CHARS,
    style: options.style ?? 'full',
    bytes: true,
    maxSymbols: MAX_SYMBOLS,
    // The worker gets files, not a tree: the tree is the planner's breadth tool and costs the lane
    // budget the related-file ranking needs.
    tree: false,
    lanes: lane === undefined ? undefined : { owns: lane.owns, reads: lane.reads },
    related:
      lane === undefined
        ? []
        : relatedFiles(map, seeds, { limit: RELATED_LIMIT, siblingSeeds: owned }),
  });
}
