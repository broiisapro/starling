/**
 * Optional one-line summaries for the most central files.
 *
 * "Central" is a cheap heuristic, not an import graph: count how many other files import a path
 * (relative JS/TS imports only), then fall back to declared-symbol count and size. Test files are
 * demoted because "tests for the thing" is rarely worth a summary slot.
 *
 * Summaries are cached by content SHA-1, so an unchanged repo makes zero model calls on the second
 * map. A missing LLM, a failed call or a broken cache never fails the map.
 */
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { LLM, RepoFile } from '@starling/core';
import { contentSha1, loadSummaryCache, saveSummaryCache } from './cache';
import { mapLimit } from './util';

const SUMMARY_LIMIT = 20;
const SUMMARY_CONCURRENCY = 4;
const CONTENT_CHARS = 4000;
const SUMMARY_MAX_CHARS = 160;

const CODE_LANGUAGES: ReadonlySet<string> = new Set([
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'swift',
  'kotlin',
  'java',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
]);

const JS_IMPORTS: readonly RegExp[] = [
  /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

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
];

/** Relative import specifiers declared in a source file. Non-relative (package) imports are ignored. */
export function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  for (const pattern of JS_IMPORTS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(source);
    while (match !== null) {
      const spec = match[1];
      if (spec?.startsWith('.')) specs.push(spec);
      if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
      match = pattern.exec(source);
    }
  }
  return specs;
}

function resolveImport(fromPath: string, specifier: string, known: ReadonlySet<string>): string | undefined {
  const base = posix.resolve('/', posix.dirname(fromPath), specifier).slice(1);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (known.has(candidate)) return candidate;
  }
  return undefined;
}

/** Count incoming relative imports per file. Unknown targets (node_modules, aliases) are ignored. */
export function computeIncomingCounts(
  files: readonly { path: string; imports: readonly string[] }[],
): Map<string, number> {
  const known = new Set(files.map((file) => file.path));
  const counts = new Map<string, number>();
  for (const file of files) {
    const seen = new Set<string>();
    for (const specifier of file.imports) {
      const target = resolveImport(file.path, specifier, known);
      if (target === undefined || target === file.path || seen.has(target)) continue;
      seen.add(target);
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
  }
  return counts;
}

export function isTestFile(path: string): boolean {
  const base = path.split('/').at(-1) ?? '';
  return (
    /\.(test|spec)\.[^.]+$/.test(base) ||
    path.startsWith('tests/') ||
    path.includes('/tests/') ||
    path.includes('/__tests__/')
  );
}

function scoreFile(file: RepoFile, incoming: number): number {
  let score = incoming * 10 + Math.min(file.symbols.length, 10) * 2 + Math.min(file.bytes / 2000, 2);
  if (isTestFile(file.path)) score -= 6;
  return score;
}

export interface SummarizeInput {
  root: string;
  files: readonly RepoFile[];
  imports: ReadonlyMap<string, readonly string[]>;
  llm: LLM;
  cacheDir: string;
  limit?: number;
}

function cleanSummary(text: string): string | undefined {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('```')) continue;
    const cleaned = line
      .replace(/^[-*#>\s]+/, '')
      .replace(/^(?:file\s+)?summary\s*:\s*/i, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length === 0) continue;
    return cleaned.length > SUMMARY_MAX_CHARS
      ? `${cleaned.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`
      : cleaned;
  }
  return undefined;
}

async function readContent(root: string, path: string): Promise<string | undefined> {
  try {
    return await readFile(join(root, path), 'utf8');
  } catch {
    // A file can disappear between `git ls-files` and this read; a missing summary is harmless.
    return undefined;
  }
}

/**
 * Summarize up to `limit` central files. Returns path → summary (possibly empty when no LLM or no
 * candidate). Never throws for LLM/cache/IO problems.
 */
export async function summarizeCentralFiles(input: SummarizeInput): Promise<Map<string, string>> {
  const summaries = new Map<string, string>();
  const candidates = input.files.filter((file) => CODE_LANGUAGES.has(file.lang));
  if (candidates.length === 0) return summaries;

  const incoming = computeIncomingCounts(
    candidates.map((file) => ({ path: file.path, imports: input.imports.get(file.path) ?? [] })),
  );
  const targets = candidates
    .map((file) => ({ file, score: scoreFile(file, incoming.get(file.path) ?? 0) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.file.path < b.file.path ? -1 : 1))
    .slice(0, input.limit ?? SUMMARY_LIMIT)
    .map((entry) => entry.file);

  if (targets.length === 0) return summaries;

  const cache = await loadSummaryCache(input.cacheDir);
  const fresh = new Map<string, string>();

  await mapLimit(targets, SUMMARY_CONCURRENCY, async (file) => {
    const content = await readContent(input.root, file.path);
    if (content === undefined || content.trim().length === 0) return;
    const key = contentSha1(content);
    const cached = cache[key];
    if (cached !== undefined) {
      summaries.set(file.path, cached);
      return;
    }
    try {
      const response = await input.llm.complete({
        role: 'summarizer',
        system:
          'You describe source files for a repository map. Reply with one short sentence (max 20 words) about what the file does. No preamble, no code fences.',
        messages: [{ role: 'user', content: `File: ${file.path}\n\n${content.slice(0, CONTENT_CHARS)}` }],
        maxTokens: 80,
        temperature: 0,
      });
      const summary = cleanSummary(response.text);
      if (summary === undefined) return;
      summaries.set(file.path, summary);
      fresh.set(key, summary);
    } catch {
      // Summaries are enrichment. One failed local-model call must not lose the whole repo map;
      // the file simply ships without a summary and the cache entry is retried next run.
    }
  });

  if (fresh.size > 0) {
    await saveSummaryCache(input.cacheDir, { ...cache, ...Object.fromEntries(fresh) });
  }
  return summaries;
}
