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
import { isSkippedPath, langForPath } from './languages';
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
const DEFAULT_MAX_FILES = 5000;
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
  return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).slice(0, maxFiles);
}

async function readRepoFile(root: string, path: string): Promise<ScannedFile | undefined> {
  const full = join(root, path);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(full);
  } catch {
    // Listed by git, gone by the time we read it (dirty worktree, deleted symlink). Skip it.
    return undefined;
  }
  if (!info.isFile() || info.size > MAX_FILE_BYTES) return undefined;

  let buffer: Uint8Array;
  try {
    buffer = new Uint8Array(await Bun.file(full).arrayBuffer());
  } catch {
    // Unreadable file: a partial repo map is more useful than a failed run.
    return undefined;
  }
  if (!isTextBuffer(buffer)) return undefined;

  const content = new TextDecoder().decode(buffer);
  const lang = langForPath(path);
  const symbols = extractSymbols(content, lang);
  const imports = lang === 'typescript' || lang === 'javascript' ? extractImportSpecifiers(content) : [];

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
      map.tokenEstimate = Math.ceil(renderRepoMap(map, { maxTokens: FULL_RENDER_TOKENS }).length / 4);
      return map;
    },
  };
}
