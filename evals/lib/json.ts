import { readFileSync } from 'node:fs';
import { toStarlingError } from './core';

/** Read and parse a JSON file, wrapping IO/parse failures in a `StarlingError`. */
export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (err) {
    throw toStarlingError(err, 'INVALID_ARGUMENT', `Cannot read JSON at ${path}`);
  }
}
