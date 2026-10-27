/**
 * The relative-import graph, and the "what is next to this lane?" question built on it.
 *
 * `RepoMap` (LOCKED in ARCHITECTURE §6) has no field for edges, and stretching the contract for a
 * rendering hint is not worth it. Instead the mapper attaches the graph to the `RepoMap` object in a
 * `WeakMap`: it costs nothing, it never leaks into JSON or zod, and a map that did not come from
 * `createRepoMapper` (a fixture, a recorded run) simply has no graph and degrades to path siblings.
 *
 * Only relative JS/TS specifiers produce edges — the same cheap rule `summaries.ts` uses. Package,
 * alias and Python/Go/Rust imports are not resolved; see the epic doc's limitations.
 */
import { posix } from 'node:path';
import type { RepoMap } from '@starling/core';

export interface ImportGraph {
  /** path → repo-relative paths that it imports. */
  imports: ReadonlyMap<string, readonly string[]>;
  /** path → repo-relative paths that import it. */
  importers: ReadonlyMap<string, readonly string[]>;
}

const RESOLVE_SUFFIXES: readonly string[] = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.json',
  '.css',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
  '/__init__.py',
];

/** Resolve a relative specifier against the known file set, trying the usual extensions. */
export function resolveImportPath(
  fromPath: string,
  specifier: string,
  known: ReadonlySet<string>,
): string | undefined {
  const base = posix.resolve('/', posix.dirname(fromPath), specifier).slice(1);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (known.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Build both directions of the graph from per-file specifier lists. Unknown targets (packages,
 * path aliases) are dropped; self-edges and duplicates are ignored.
 */
export function buildImportGraph(
  files: readonly { path: string; imports: readonly string[] }[],
): ImportGraph {
  const known = new Set(files.map((file) => file.path));
  const imports = new Map<string, readonly string[]>();
  const importers = new Map<string, Set<string>>();

  for (const file of files) {
    const targets = new Set<string>();
    for (const specifier of file.imports) {
      const target = resolveImportPath(file.path, specifier, known);
      if (target === undefined || target === file.path) continue;
      targets.add(target);
    }
    if (targets.size === 0) continue;
    const sorted = [...targets].sort((a, b) => (a < b ? -1 : 1));
    imports.set(file.path, sorted);
    for (const target of sorted) {
      const back = importers.get(target);
      if (back === undefined) importers.set(target, new Set([file.path]));
      else back.add(file.path);
    }
  }

  const importersOut = new Map<string, readonly string[]>();
  for (const [target, back] of importers) {
    importersOut.set(
      target,
      [...back].sort((a, b) => (a < b ? -1 : 1)),
    );
  }
  return { imports, importers: importersOut };
}

const GRAPHS = new WeakMap<RepoMap, ImportGraph>();

/** Attach a graph to a map object. Idempotent; the last graph wins. */
export function attachImportGraph(map: RepoMap, graph: ImportGraph): void {
  GRAPHS.set(map, graph);
}

/** The graph the mapper attached, if this map came from the mapper. */
export function importGraphOf(map: RepoMap): ImportGraph | undefined {
  return GRAPHS.get(map);
}

export interface RelatedFilesOptions {
  /** Maximum paths returned. Default 24. */
  limit?: number;
  /** Include same-directory files after the import neighbours. Default true. */
  includeSiblings?: boolean;
  /**
   * Seeds whose same-directory files count as siblings. Defaults to every seed.
   *
   * A lane's own folder is where siblings matter; the siblings of a *read* file are usually noise
   * (a 400-file tree answered "what is near the store?" with nine unrelated modules).
   */
  siblingSeeds?: readonly string[];
}

function siblingPaths(map: RepoMap, seed: string, known: ReadonlySet<string>): string[] {
  const dir = posix.dirname(seed);
  const prefix = dir === '.' ? '' : `${dir}/`;
  return map.files
    .filter((file) => file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes('/'))
    .map((file) => file.path)
    .filter((path) => known.has(path))
    .sort((a, b) => (a < b ? -1 : 1));
}

/**
 * Files that matter around a set of seed files, in priority order:
 *
 * 1. **importers** — who depends on the lane's API (editing an export can break them);
 * 2. **imports** — what the lane builds on;
 * 3. **siblings** — same directory, for repos the import graph cannot see (Python, Go, Rust, …).
 *
 * Deterministic: seeds, edges and siblings are all path-sorted. Empty seeds → empty result.
 */
export function relatedFiles(
  map: RepoMap,
  seeds: readonly string[],
  options: RelatedFilesOptions = {},
): string[] {
  const limit = Math.max(0, Math.floor(options.limit ?? 24));
  if (limit === 0) return [];
  const known = new Set(map.files.map((file) => file.path));
  const seedSet = new Set(seeds.filter((seed) => known.has(seed)));
  if (seedSet.size === 0) return [];
  const sortedSeeds = [...seedSet].sort((a, b) => (a < b ? -1 : 1));

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (path: string): boolean => {
    if (out.length >= limit) return false;
    if (seedSet.has(path) || seen.has(path) || !known.has(path)) return true;
    seen.add(path);
    out.push(path);
    return true;
  };

  const graph = importGraphOf(map);
  if (graph !== undefined) {
    for (const seed of sortedSeeds) {
      for (const importer of graph.importers.get(seed) ?? []) push(importer);
    }
    for (const seed of sortedSeeds) {
      for (const target of graph.imports.get(seed) ?? []) push(target);
    }
  }

  if (options.includeSiblings !== false) {
    const siblingSeeds = (options.siblingSeeds ?? sortedSeeds)
      .filter((seed) => known.has(seed))
      .sort((a, b) => (a < b ? -1 : 1));
    for (const seed of siblingSeeds) {
      for (const sibling of siblingPaths(map, seed, known)) push(sibling);
    }
  }

  return out;
}
