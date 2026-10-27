/** Write machine-readable copies of a load run under `tools/load/results/`. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const RESULTS_DIR = join(import.meta.dir, 'results');

export async function writeResult(name: string, value: unknown): Promise<string> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const path = join(RESULTS_DIR, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}

/** Parse `--key value` / `--flag` arguments without pulling in a CLI library. */
export function parseArgs(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined || !arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      parsed.set(key, next);
      index += 1;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

export function numberArg(args: Map<string, string | true>, key: string, fallback: number): number {
  const raw = args.get(key);
  if (typeof raw !== 'string') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Like `numberArg`, but 0 is a meaningful value (e.g. `--headroom 0`). */
export function zeroableNumberArg(args: Map<string, string | true>, key: string, fallback: number): number {
  const raw = args.get(key);
  if (typeof raw !== 'string') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}
