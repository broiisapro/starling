/**
 * `RepoMapper` — turn a git repo into a compact, budgeted `RepoMap`.
 *
 * The scanner is deliberately boring: one `git ls-files` call, a bounded parallel read of the
 * files, regex symbols, a rendered tree, detected commands. No parsers, no import graph, no
 * embeddings. That keeps a 2,000-file repo under the two-second bar in the assignment while still
 * giving the planner and the prompt compiler enough to work with.
 */
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Clock, LLM, RepoFile, RepoMap, RepoMapper } from '@starling/core';
import { exec, StarlingError, systemClock } from '@starling/core';
import { detectCommands } from './commands';
import { attachImportGraph, buildImportGraph } from './imports';
import { isBinaryPath, isSkippedPath, langForPath, SYMBOL_LANGUAGES } from './languages';
import { renderRepoMap } from './render';
import { extractImportSpecifiers, summarizeCentralFiles } from './summaries';
import { extractSymbols } from './symbols';
import { renderTree } from './tree';
import { mapLimit } from './util';

export interface RepoMapperOptions {
  /** Injectable for tests (ARCHITECTURE L13). Defaults to core's argv-only `exec`. */
  exec?: typeof exec;
  /** Required only for `map(..., { summarize: true })`; absent means no summaries, no error. */
  llm?: LLM;
  /** Summary cache directory. Default `~/.starling/repomap-cache`. */
  cacheDir?: string;
  clock?: Clock;
}

/** Files above this are generated, vendored or minified often enough that the loss is worth it. */
const MAX_FILE_BYTES = 256 * 1024;
/** NUL-byte sniff window for "this is a binary". */
const BINARY_SNIFF_BYTES = 8 * 1024;
/**
 * Default ceiling on listed paths. A 7k-file Django checkout maps completely; past this the list is
 * evenly sampled instead of being cut alphabetically (which used to lose `tests/` on any big repo).
 */
const DEFAULT_MAX_FILES = 8000;
const TREE_MAX_CHARS = 4000;
const READ_CONCURRENCY = 24;
const GIT_TIMEOUT_MS = 15_000;
/** Used only to size the full rendering for `tokenEstimate`; no real prompt uses this budget. */
const FULL_RENDER_TOKENS = 1_000_000;

interface ScannedFile {
  file: RepoFile;
  imports: string[];
}

function isTextBuffer(buffer: Uint8Array): boolean {
  const limit = Math.min(BINARY_SNIFF_BYTES, buffer.length);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return false;
  }
  return true;
}

/**
 * Take every `ceil(n / max)`-th path. Cutting the sorted list at `max` silently drops the end of the
 * alphabet — on Django that meant most of `tests/` — while even sampling keeps the whole tree
 * represented (with a smaller share of each directory).
 */
export function samplePaths(sorted: readonly string[], maxFiles: number): string[] {
  if (maxFiles <= 0) return [];
  if (sorted.length <= maxFiles) return [...sorted];
  const stride = Math.ceil(sorted.length / maxFiles);
  const out: string[] = [];
  for (let i = 0; i < sorted.length && out.length < maxFiles; i += stride) {
    out.push(sorted[i] as string);
  }
  return out;
}

async function listRepoFiles(root: string, run: typeof exec, maxFiles: number): Promise<string[]> {
  let result: Awaited<ReturnType<typeof exec>>;
  try {
    result = await run(['git', 'ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: root,
      timeoutMs: GIT_TIMEOUT_MS,
    });
  } catch (err) {
    throw new StarlingError('REPOMAP_ERROR', `Could not list files in ${root}`, {
      cause: err,
      details: { repoPath: root },
    });
  }
  if (result.code !== 0) {
    throw new StarlingError('REPOMAP_ERROR', `git ls-files failed in ${root}`, {
      details: { code: result.code, stderr: result.stderr.slice(0, 500) },
    });
  }

  const seen = new Set<string>();
  for (const entry of result.stdout.split('\0')) {
    if (entry.length === 0) continue;
    const path = entry.replace(/\\/g, '/');
    if (isSkippedPath(path)) continue;
    seen.add(path);
  }
  const sorted = [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return samplePaths(sorted, maxFiles);
}

/**
 * Read one file's head, decide whether it is text, and only read the rest when a symbol extractor
 * needs it. Non-code languages (JSON, YAML, HTML, translations, fixtures) are the bulk of a big
 * repo and contribute no symbols, so the old "read everything, sniff, discard" loop was pure I/O.
 */
async function readRepoFile(root: string, path: string): Promise<ScannedFile | undefined> {
  if (isBinaryPath(path)) return undefined;
  const full = join(root, path);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(full);
  } catch {
    // Listed by git, gone by the time we read it (dirty worktree, deleted symlink). Skip it.
    return undefined;
  }
  if (!info.isFile() || info.size > MAX_FILE_BYTES) return undefined;

  const lang = langForPath(path);
  const needsContent = SYMBOL_LANGUAGES.has(lang);
  const file = Bun.file(full);
  let buffer: Uint8Array;
  try {
    // Symbol-bearing files are read once in full; everything else only needs its head to prove it
    // is text, which is most of a real checkout (fixtures, translations, JSON, docs).
    buffer = needsContent
      ? new Uint8Array(await file.arrayBuffer())
      : new Uint8Array(await file.slice(0, BINARY_SNIFF_BYTES).arrayBuffer());
  } catch {
    // Unreadable file: a partial repo map is more useful than a failed run.
    return undefined;
  }
  if (!isTextBuffer(buffer)) return undefined;
  if (!needsContent) {
    return { file: { path, bytes: info.size, lang, symbols: [] }, imports: [] };
  }

  const content = new TextDecoder().decode(buffer);
  const symbols = extractSymbols(content, lang);
  const imports =
    lang === 'typescript' || lang === 'javascript' || lang === 'python'
      ? extractImportSpecifiers(content, lang)
      : [];
  return { file: { path, bytes: info.size, lang, symbols }, imports };
}

function countLanguages(files: readonly RepoFile[]): Record<string, number> {
  const languages: Record<string, number> = {};
  for (const file of files) {
    languages[file.lang] = (languages[file.lang] ?? 0) + 1;
  }
  return languages;
}

/**
 * Create a `RepoMapper`. Everything injectable is optional; the defaults are the production ports.
 *
 * ```ts
 * const mapper = createRepoMapper({ llm });
 * const map = await mapper.map('/path/to/repo', { summarize: true });
 * ```
 */
export function createRepoMapper(options: RepoMapperOptions = {}): RepoMapper {
  const run = options.exec ?? exec;
  const clock = options.clock ?? systemClock;
  const cacheDir = options.cacheDir ?? join(homedir(), '.starling', 'repomap-cache');

  return {
    async map(repoPath, mapOptions = {}) {
      const root = resolve(repoPath);
      let rootInfo: Awaited<ReturnType<typeof stat>>;
      try {
        rootInfo = await stat(root);
      } catch (err) {
        throw new StarlingError('REPOMAP_ERROR', `Repo path does not exist: ${repoPath}`, {
          cause: err,
          details: { repoPath },
        });
      }
      if (!rootInfo.isDirectory()) {
        throw new StarlingError('REPOMAP_ERROR', `Repo path is not a directory: ${repoPath}`, {
          details: { repoPath },
        });
      }

      const maxFiles =
        mapOptions.maxFiles === undefined ? DEFAULT_MAX_FILES : Math.max(0, Math.floor(mapOptions.maxFiles));
      const paths = await listRepoFiles(root, run, maxFiles);
      const scanned = await mapLimit(paths, READ_CONCURRENCY, (path) => readRepoFile(root, path));
      const kept = scanned.filter((entry): entry is ScannedFile => entry !== undefined);
      const files = kept.map((entry) => entry.file);

      if (mapOptions.summarize === true && options.llm !== undefined) {
        const imports = new Map<string, readonly string[]>(
          kept.map((entry) => [entry.file.path, entry.imports]),
        );
        const summaries = await summarizeCentralFiles({
          root,
          files,
          imports,
          llm: options.llm,
          cacheDir,
        });
        for (const file of files) {
          const summary = summaries.get(file.path);
          if (summary !== undefined) file.summary = summary;
        }
      }

      const languages = countLanguages(files);
      const commands = detectCommands(
        root,
        files.map((file) => file.path),
      );
      const tree = renderTree(files, { maxChars: TREE_MAX_CHARS, root: basename(root) });

      const map: RepoMap = {
        root,
        tree,
        files,
        languages,
        ...commands,
        tokenEstimate: 0,
        createdAt: clock.now(),
      };
      attachImportGraph(
        map,
        buildImportGraph(kept.map((entry) => ({ path: entry.file.path, imports: entry.imports }))),
      );
      map.tokenEstimate = Math.ceil(renderRepoMap(map, { maxTokens: FULL_RENDER_TOKENS }).length / 4);
      return map;
    },
  };
}
