/**
 * Server URL rules and the health probe (Epic 118).
 *
 * The dashboard talks to one hub. A viewer may point it at a different machine on the LAN, so the
 * field accepts an origin only: `''` (same origin) or `http(s)://host[:port]`. Paths, credentials,
 * query strings and fragments are rejected rather than silently stripped — a "helpful" normalisation
 * would hide a typo (`/api` on the end) behind a URL that looks fine but 404s every request.
 *
 * `javascript:` / `data:` are rejected by the protocol allow-list before any request is made.
 */
export const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;

export interface ServerUrlCheck {
  ok: boolean;
  /** Canonical form when `ok`; `''` otherwise. Safe to store. */
  value: string;
  /** Human-readable reason when `!ok`. */
  error?: string;
}

const ONLY_ORIGIN = 'Use the hub origin only, e.g. http://192.168.1.10:7777 — no path, query or credentials.';

/**
 * Validate a candidate server URL. Never throws, never returns a partially-trusted value: on any
 * doubt the result is `{ ok: false, value: '' }`.
 */
export function checkServerUrl(raw: unknown): ServerUrlCheck {
  if (typeof raw !== 'string') return { ok: false, value: '', error: ONLY_ORIGIN };
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: '' };
  if (trimmed.length > 2_048) return { ok: false, value: '', error: 'That URL is too long.' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, value: '', error: 'Enter a full http(s) URL, e.g. http://localhost:7777.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, value: '', error: 'Only http:// and https:// hubs are allowed.' };
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, value: '', error: 'Remove the username and password from the URL.' };
  }
  if (url.search !== '' || url.hash !== '') {
    return { ok: false, value: '', error: 'Drop the query string and #fragment from the hub URL.' };
  }
  if (url.pathname !== '' && url.pathname !== '/') {
    return { ok: false, value: '', error: ONLY_ORIGIN };
  }
  if (url.hostname === '') {
    return { ok: false, value: '', error: 'That URL has no host.' };
  }

  return { ok: true, value: `${url.protocol}//${url.host}` };
}

/** The stored form of a candidate: a valid origin, or `''` (same origin) for anything else. */
export function normalizeServerUrl(raw: unknown): string {
  return checkServerUrl(raw).value;
}

/** Where a health check goes. Same-origin uses a relative URL so it inherits the page's origin. */
export function healthUrl(serverUrl: string): string {
  const origin = normalizeServerUrl(serverUrl);
  return origin === '' ? '/api/health' : `${origin}/api/health`;
}

export interface HealthCheckResult {
  ok: boolean;
  /** HTTP status when the hub answered at all. */
  status?: number;
  detail: string;
}

export interface HealthCheckOptions {
  /** Injected in tests and by hosts that wrap `fetch` (Epic 204 attaches the token). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Probe `${serverUrl}/api/health`. It resolves — never rejects — with a short, printable result, so a
 * button handler cannot turn a dead hub into an unhandled rejection.
 */
export async function testServerHealth(
  serverUrl: string,
  options: HealthCheckOptions = {},
): Promise<HealthCheckResult> {
  const target = healthUrl(serverUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    return { ok: false, detail: 'No fetch available in this browser.' };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const controller = typeof AbortController === 'undefined' ? undefined : new AbortController();
  const timer = setTimeout(() => controller?.abort(), Math.max(1, timeoutMs));

  try {
    const response = await fetchImpl(target, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller?.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      return { ok: false, status: response.status, detail: `Hub answered ${response.status}.` };
    }
    return { ok: true, status: response.status, detail: 'Hub answered — the flock is reachable.' };
  } catch (error) {
    if (controller?.signal.aborted === true) {
      return { ok: false, detail: `No answer within ${timeoutMs} ms.` };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: reason.trim() === '' ? 'Request failed.' : `Request failed: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
