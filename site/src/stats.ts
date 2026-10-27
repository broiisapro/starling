/**
 * "Built by the flock" numbers.
 *
 * The page ships with placeholder values in the HTML, then upgrades them from
 * `site/data/stats.json` at runtime. That file is Epic 68's contract: its collector regenerates it
 * from git + GitHub, so the landing page can show live proof without a rebuild.
 *
 * The normaliser is deliberately forgiving: Epic 68 may name its totals a little differently, and a
 * hand-written file should never break the page. Unknown or broken fields fall back to the
 * placeholders that are already on screen.
 */

export interface SwarmStatsView {
  epics: number;
  prs: number;
  tests: number;
  agents: number;
  laptops: number;
  commits: number;
  generatedAt: string | null;
  source: string | null;
}

export const FALLBACK_STATS: SwarmStatsView = {
  epics: 28,
  prs: 28,
  tests: 1785,
  agents: 35,
  laptops: 2,
  commits: 37,
  generatedAt: null,
  source: null,
};

export const STAT_KEYS = ['epics', 'prs', 'tests', 'agents', 'laptops', 'commits'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** First positive, finite number among `candidates`, or `undefined`. Numeric strings are allowed. */
function pickNumber(candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
      return Math.round(candidate);
    }
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      const parsed = Number(candidate.replace(/[,_\s]/g, ''));
      if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
    }
  }
  return undefined;
}

function pickString(candidates: readonly unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim();
  }
  return null;
}

/**
 * Normalise `stats.json` into the six numbers the page renders.
 *
 * Accepts both the canonical shape (`{ totals: { epics, prs, ... } }`) and a flat file, plus the
 * aliases Epic 68 is likely to use (`peakConcurrentAgents`, `pullRequests`, `testCount`, …).
 */
export function normalizeStats(raw: unknown, fallback: SwarmStatsView = FALLBACK_STATS): SwarmStatsView {
  if (!isRecord(raw)) return { ...fallback };
  const totals = isRecord(raw.totals) ? raw.totals : raw;
  const epicList = Array.isArray(raw.epics) ? raw.epics : Array.isArray(totals.epics) ? totals.epics : null;
  const waveList = Array.isArray(raw.waves) ? raw.waves : null;

  const waveAgents = waveList
    ? waveList.reduce<number>((sum, wave) => {
        if (!isRecord(wave)) return sum;
        return sum + (pickNumber([wave.agents, wave.agentCount]) ?? 0);
      }, 0)
    : undefined;

  return {
    epics:
      pickNumber([totals.epics, totals.epicCount, totals.totalEpics, totals.epicTotal, epicList?.length]) ??
      fallback.epics,
    prs:
      pickNumber([totals.prs, totals.pullRequests, totals.prCount, totals.totalPrs, totals.mergedPrs]) ??
      fallback.prs,
    tests:
      pickNumber([
        totals.tests,
        totals.testCount,
        totals.testsTotal,
        totals.testsPassing,
        totals.totalTests,
      ]) ?? fallback.tests,
    agents:
      pickNumber([
        totals.agents,
        totals.agentsPeak,
        totals.peakAgents,
        totals.peakConcurrentAgents,
        totals.maxAgents,
        waveAgents,
      ]) ?? fallback.agents,
    laptops:
      pickNumber([totals.laptops, totals.machines, totals.nodes, totals.laptopCount]) ?? fallback.laptops,
    commits: pickNumber([totals.commits, totals.commitCount, totals.totalCommits]) ?? fallback.commits,
    generatedAt: pickString([raw.generatedAt, raw.generated, raw.updatedAt, raw.updated]) ?? null,
    source: pickString([raw.source, raw.kind]) ?? null,
  };
}

const integerFormat = new Intl.NumberFormat('en-US');

/** `1785` → `"1,785"`. Tabular and locale-stable so the tiles do not jump between visits. */
export function formatCount(value: number): string {
  return integerFormat.format(Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
}

/** ISO timestamp → `"27 October 2026"`. Returns the input for anything unparseable. */
export function formatGeneratedAt(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/** Write the normalised totals into the tiles that are already in the HTML. */
export function renderStats(doc: Document, stats: SwarmStatsView): void {
  for (const key of STAT_KEYS) {
    for (const node of doc.querySelectorAll<HTMLElement>(`[data-stat="${key}"]`)) {
      node.textContent = formatCount(stats[key]);
    }
  }

  const generated = formatGeneratedAt(stats.generatedAt);
  if (generated !== null) {
    for (const node of doc.querySelectorAll<HTMLElement>('[data-stats-date]')) {
      node.textContent = generated;
    }
  }
}

/**
 * Fetch and render `./data/stats.json`. Never throws: a missing file (opened from `file://`, or a
 * collector that has not run yet) just leaves the placeholders in place.
 */
export async function hydrateStats(doc: Document = document, fetchImpl?: typeof fetch): Promise<void> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return;
  try {
    const response = await doFetch('./data/stats.json', { cache: 'no-cache' });
    if (!response.ok) return;
    const raw: unknown = await response.json();
    renderStats(doc, normalizeStats(raw));
  } catch {
    // Offline, file://, or malformed JSON — the hand-written placeholders remain. That is fine.
  }
}
