/**
 * Content-addressed cache for repo-map summaries.
 *
 * One JSON file per cache directory, keyed by SHA-1 of the file content. Content addressing means a
 * renamed or edited file misses, and an unchanged repo costs zero LLM calls on the second run.
 * Cache failures are never fatal: the cache is an optimisation, not state.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CACHE_FILE = 'summaries.json';
const CACHE_VERSION = 1;
const MAX_ENTRIES = 5000;

interface CacheFile {
  version: number;
  entries: Record<string, string>;
}

export function contentSha1(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

/** Load a cache, returning `{}` for anything missing, malformed or from another version. */
export async function loadSummaryCache(cacheDir: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(cacheDir, CACHE_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Partial<CacheFile>;
    if (parsed.version !== CACHE_VERSION) return {};
    if (parsed.entries === undefined || parsed.entries === null) return {};
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.entries)) {
      if (typeof value === 'string' && value.length > 0) entries[key] = value;
    }
    return entries;
  } catch {
    // Missing cache on the first run is normal; corrupt cache is self-healing (we rewrite it).
    return {};
  }
}

/** Persist a cache. Best effort: a read-only or full disk must not break mapping. */
export async function saveSummaryCache(cacheDir: string, entries: Record<string, string>): Promise<void> {
  const keys = Object.keys(entries);
  const trimmed: Record<string, string> = {};
  for (const key of keys.slice(Math.max(0, keys.length - MAX_ENTRIES))) {
    trimmed[key] = entries[key] as string;
  }
  const body: CacheFile = { version: CACHE_VERSION, entries: trimmed };
  const target = join(cacheDir, CACHE_FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(tmp, `${JSON.stringify(body)}\n`, 'utf8');
    await rename(tmp, target);
  } catch {
    // Cache writes are advisory. Dropping one means a slower next run, not a wrong repo map.
  }
}
