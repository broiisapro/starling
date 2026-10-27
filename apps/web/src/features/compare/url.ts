import { BASELINE_VALUE, type CompareParams } from './selection';

/**
 * `?a=&b=` URL helpers. The page keeps its pair shareable: choosing a run calls
 * `history.replaceState` with the new pair and leaves every other query parameter (demo, speed,
 * run) alone. Pure parsing is separated from the `history` write so tests can stub either.
 */

export interface CompareHistory {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export interface CompareLocation {
  search: string;
  hash?: string;
}

function paramsOf(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

export function parseCompareParams(search: string): CompareParams {
  const params = paramsOf(search);
  const paramsOut: CompareParams = {};
  const a = params.get('a')?.trim();
  const b = params.get('b')?.trim();
  if (a !== undefined && a !== '') paramsOut.a = a;
  if (b !== undefined && b !== '') paramsOut.b = b;
  return paramsOut;
}

/** `?a=…&b=…`, preserving unrelated parameters. `b` may be the literal `baseline`. */
export function compareSearch(search: string, a: string, b: string | undefined): string {
  const params = paramsOf(search);
  params.set('a', a);
  if (b === undefined || b === '') params.delete('b');
  else params.set('b', b);
  return `?${params.toString()}`;
}

/** The exact URL string the page writes for a pair. */
export function compareHref(location: CompareLocation, a: string, b: string | undefined): string {
  return `${compareSearch(location.search, a, b)}${location.hash ?? ''}`;
}

/**
 * Write the pair into the address bar without a navigation (shareable, refresh-proof).
 * Returns the search string for tests and for callers that want to display it.
 */
export function writeCompareUrl(
  a: string,
  b: string | undefined,
  history: CompareHistory | undefined = globalThis.history,
  location: CompareLocation | undefined = globalThis.location,
): string {
  const search = compareSearch(location?.search ?? '', a, b);
  const href = `${search}${location?.hash ?? ''}`;
  history?.replaceState(null, '', href);
  return search;
}

/** The picker value for the B side: a run id, or `baseline`. */
export function pickerValue(runId: string | undefined, baseline: boolean): string {
  return baseline || runId === undefined ? BASELINE_VALUE : runId;
}
