import { describe, expect, test } from 'bun:test';
import {
  checkServerUrl,
  DEFAULT_HEALTH_TIMEOUT_MS,
  healthUrl,
  normalizeServerUrl,
  testServerHealth,
} from './url';

describe('server URL validation', () => {
  test('an empty value means same-origin', () => {
    expect(checkServerUrl('')).toEqual({ ok: true, value: '' });
    expect(checkServerUrl('   ')).toEqual({ ok: true, value: '' });
    expect(normalizeServerUrl(undefined)).toBe('');
    expect(normalizeServerUrl(42)).toBe('');
  });

  test('accepts an absolute http(s) origin and normalises it', () => {
    expect(checkServerUrl('http://127.0.0.1:7777')).toEqual({
      ok: true,
      value: 'http://127.0.0.1:7777',
    });
    expect(normalizeServerUrl('HTTPS://Hub.Example:7777/')).toBe('https://hub.example:7777');
    expect(normalizeServerUrl('  http://192.168.1.10:7777  ')).toBe('http://192.168.1.10:7777');
  });

  test.each([
    ['javascript:alert(1)', 'protocol'],
    ['data:text/html,<script>', 'protocol'],
    ['file:///etc/passwd', 'protocol'],
    ['ftp://hub.example', 'protocol'],
    ['http://user:pw@hub.example:7777', 'credentials'],
    ['http://hub.example:7777/api', 'path'],
    ['http://hub.example:7777/../admin', 'path'],
    ['http://hub.example:7777/?token=1', 'query'],
    ['http://hub.example:7777/#x', 'fragment'],
    ['/api/health', 'relative'],
  ])('rejects hostile or ambiguous value %s', (value) => {
    const result = checkServerUrl(value);
    expect(result.ok).toBe(false);
    expect(result.value).toBe('');
    expect(typeof result.error).toBe('string');
  });

  test('rejects an over-long URL', () => {
    const long = `http://hub.example/${'a'.repeat(3_000)}`;
    expect(checkServerUrl(long).ok).toBe(false);
  });

  test('healthUrl is relative for same-origin and absolute for a hub', () => {
    expect(healthUrl('')).toBe('/api/health');
    expect(healthUrl('http://localhost:7777')).toBe('http://localhost:7777/api/health');
    expect(healthUrl('javascript:alert(1)')).toBe('/api/health');
  });
});

describe('health check', () => {
  test('resolves ok with the status when the hub answers', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;

    const result = await testServerHealth('http://localhost:7777', { fetchImpl });
    expect(result).toEqual({ ok: true, status: 200, detail: 'Hub answered — the flock is reachable.' });
    expect(calls).toEqual([{ url: 'http://localhost:7777/api/health', method: 'GET' }]);
  });

  test('same-origin probes the relative endpoint', async () => {
    let seen = '';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      seen = String(input);
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;
    await testServerHealth('', { fetchImpl });
    expect(seen).toBe('/api/health');
  });

  test('a non-2xx answer is a clean failure, not a throw', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 503 }) as Response) as unknown as typeof fetch;
    const result = await testServerHealth('http://hub:7777', { fetchImpl });
    expect(result).toEqual({ ok: false, status: 503, detail: 'Hub answered 503.' });
  });

  test('a thrown request becomes a printable failure', async () => {
    const fetchImpl = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const result = await testServerHealth('http://hub:7777', { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('connection refused');
  });

  test('a hung hub aborts after the timeout', async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as typeof fetch;

    const started = Date.now();
    const result = await testServerHealth('http://hub:7777', { fetchImpl, timeoutMs: 20 });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('20 ms');
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('a normal hub answers well inside the default budget', () => {
    expect(DEFAULT_HEALTH_TIMEOUT_MS).toBe(2_000);
  });
});
