import { describe, expect, test } from 'bun:test';
import { PACKAGE as CORE_PACKAGE } from '@starling/core';
import { makeNodeInfo } from '@starling/core/testing';
import { createApp, VERSION } from './app';
import { PACKAGE } from './index';

describe('@starling/server skeleton', () => {
  test('exports its package name and imports core', () => {
    expect(PACKAGE).toBe('@starling/server');
    expect(CORE_PACKAGE).toBe('@starling/core');
    expect(makeNodeInfo().status).toBe('online');
  });

  test('GET /api/health returns ok and the version', async () => {
    const res = await createApp().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: VERSION });
  });

  test('unknown routes are 404', async () => {
    const res = await createApp().request('/api/nope');
    expect(res.status).toBe(404);
  });
});
