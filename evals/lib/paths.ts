import { resolve } from 'node:path';

/** Repository root (`evals/lib/../..`). */
export const REPO_ROOT = resolve(import.meta.dir, '../..');

/** Where `run.ts` writes `<suite>-<date>.json` reports. */
export const RESULTS_DIR = resolve(import.meta.dir, '../results');
