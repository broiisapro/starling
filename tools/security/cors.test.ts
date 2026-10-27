/**
 * Probes: CORS on the hub.
 *
 * The dashboard runs on the Vite dev server (`localhost:5173`) and talks to the hub directly, so the
 * hub allows exactly that origin. A page on any other origin must not be able to read a response or
 * send the flock token. The flock token also must not be allowed as a credential from an origin the
 * hub does not know.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { startProbeServer } from './support.ts';

const server = startProbeServer();

afterAll(() => server.stop());

const ALLOWED = 'http://localhost:5173';
const EVIL = 'http://evil.example';

describe('CORS', () => {
  test('does not grant a strange origin access to responses', async () => {
    const response = await fetch(`${server.url}/api/health`, { headers: { origin: EVIL } });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  test('grants the Vite dev origin and nothing more', async () => {
    const response = await fetch(`${server.url}/api/health`, { headers: { origin: ALLOWED } });
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  test('a preflight from a strange origin does not authorise the token header for it', async () => {
    const response = await fetch(`${server.url}/api/flock/register`, {
      method: 'OPTIONS',
      headers: {
        origin: EVIL,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-flock-token',
      },
    });
    // No `access-control-allow-origin` for EVIL means a browser blocks the request, whatever the
    // status line says. Asserting it here keeps a future Hono default from quietly reflecting origins.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('the dashboard origin may send the flock token', async () => {
    const response = await fetch(`${server.url}/api/flock/register`, {
      method: 'OPTIONS',
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type, x-flock-token',
      },
    });
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-flock-token');
  });
});
