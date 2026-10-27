import { readFile } from 'node:fs/promises';

/** One row of `.orchestrator/epics.tsv` — the orchestrator's plan of record. */
export interface EpicRow {
  /** Zero-padded epic number, e.g. `'00'`. */
  number: string;
  slug: string;
  title: string;
  /** `0`, `1`, `c1`, `2`, `3` … */
  wave: string;
  machine: string;
  lane: string;
  depends: string;
}

/** Wave display order. Waves are not numeric (`c1` sits between 1 and 2). */
const WAVE_ORDER = ['0', '1', 'c1', '2', '3'];

/** Sort key for a wave label; unknown labels sort last but keep their alphabetical order. */
export function waveRank(wave: string): number {
  const index = WAVE_ORDER.indexOf(wave);
  return index === -1 ? WAVE_ORDER.length + 1 : index;
}

/** `'7'` → `'07'`, `'00'` → `'00'`, `'c1'` → `undefined`. */
export function normalizeEpicNumber(raw: string): string | undefined {
  const digits = raw.trim();
  return /^\d+$/.test(digits) ? digits.padStart(2, '0') : undefined;
}

/** `'c1-web-wiring'` → `'C1 web wiring'`; only used when `epics.tsv` is unavailable. */
export function humanizeSlug(slug: string): string {
  const words = slug.split(/[-_]+/).filter((word) => word.length > 0);
  if (words.length === 0) return slug;
  return words
    .map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * Parse the orchestrator's tab-separated epic table.
 *
 * The first row is a header (`nn slug title wave machine lane depends`). Blank lines and rows with
 * fewer than four columns are skipped rather than throwing: the stats page is a nice-to-have and
 * must never take a build down because one hand-edited line is malformed.
 */
export function parseEpicsTsv(text: string): EpicRow[] {
  const rows: EpicRow[] = [];
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    const cells = line.split('\t').map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const [rawNumber, slug, title, wave, machine = '', lane = '', depends = ''] = cells;
    if (rawNumber === 'nn' || rawNumber === undefined) continue;
    const number = normalizeEpicNumber(rawNumber);
    if (number === undefined || slug === undefined || title === undefined || wave === undefined) continue;
    rows.push({ number, slug, title, wave, machine, lane, depends });
  }
  return rows;
}

/** Read and parse the epic table; `null` when the file does not exist. */
export async function readEpicRows(path: string): Promise<EpicRow[] | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return parseEpicsTsv(text);
}
