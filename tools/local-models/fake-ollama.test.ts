/**
 * fake-ollama.test.ts — the fake server is the only thing the dry run and the e2e tests talk to, so
 * it needs its own tests: if it drifts from the real surfaces, `--dry-run` stops proving anything.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';
import { VERDICT_SCHEMA } from './audit-request';
import { judgeAnswer } from './bench-core';
import { type AuditCase, caseRequest, loadCases } from './cases';
import { type FakeOllama, fakeModelSpec, startFakeOllama } from './fake-ollama';
import { type CallOptions, type CallResult, callV1 } from './ollama';
import { listResident, unloadModel } from './ollama-admin';

const HERE = dirname(new URL(import.meta.url).pathname);
const CASES = loadCases(join(HERE, 'cases'));

const byKey = (key: string): AuditCase => {
  const found = CASES.find((c) => c.key === key);
  if (!found) throw new Error(`missing case ${key}`);
  return found;
};

const PASS_CASE = byKey('csv-export-with-tests');
const FAIL_CASE = byKey('csv-export-no-tests');

let servers: FakeOllama[] = [];

afterEach(() => {
  for (const s of servers) s.stop();
  servers = [];
});

function fake(name: string, opts: { seedResident?: boolean } = {}): FakeOllama {
  const server = startFakeOllama({
    cases: CASES,
    models: [fakeModelSpec(name)],
    seedResident: opts.seedResident,
  });
  servers.push(server);
  return server;
}

function call(server: FakeOllama, model: string, auditCase: AuditCase): Promise<CallResult> {
  const req = caseRequest(auditCase);
  const options: CallOptions = {
    host: server.url,
    model,
    system: req.system,
    user: req.user,
    schema: VERDICT_SCHEMA,
  };
  return callV1(options);
}

describe('the smart fake', () => {
  test('passes a good diff and fails a diff that skipped its test', async () => {
    const server = fake('fake-smart');

    const good = await call(server, 'fake-smart', PASS_CASE);
    const bad = await call(server, 'fake-smart', FAIL_CASE);

    expect(good.error).toBeUndefined();
    expect(judgeAnswer(good.text, PASS_CASE.expect).correct).toBe(true);
    expect(judgeAnswer(bad.text, FAIL_CASE.expect).correct).toBe(true);
    // One streamed call must be enough: a fallback to /api/chat would mean the fake is broken.
    expect(server.requests.filter((r) => r.path === '/api/chat')).toHaveLength(0);
  });

  test('reports usage and a finite tokens/s so the timing columns are real', async () => {
    const server = fake('fake-smart');
    const result = await call(server, 'fake-smart', PASS_CASE);

    expect(result.timing.completionTokens).toBeGreaterThan(0);
    expect(result.timing.tokensPerSec).toBeGreaterThan(0);
    expect(result.timing.ttftMs).not.toBeNull();
  });
});

describe('the lazy fake', () => {
  test('passes everything, which is wrong on every must-fail case', async () => {
    const server = fake('fake-lazy');
    const result = await call(server, 'fake-lazy', FAIL_CASE);
    const judgement = judgeAnswer(result.text, FAIL_CASE.expect);

    expect(result.error).toBeUndefined();
    expect(judgement.jsonValid).toBe(true);
    expect(judgement.verdict?.pass).toBe(true);
    expect(judgement.correct).toBe(false);
  });
});

describe('the scripted failure modes', () => {
  test('the garbage model returns prose instead of JSON', async () => {
    const server = fake('fake-garbage');
    const result = await call(server, 'fake-garbage', PASS_CASE);

    expect(result.status).toBe(200);
    expect(judgeAnswer(result.text, PASS_CASE.expect).jsonValid).toBe(false);
  });

  test('the oom model returns a memory error without throwing', async () => {
    const server = fake('fake-oom');
    const result = await call(server, 'fake-oom', PASS_CASE);

    expect(result.status).toBe(500);
    expect(result.error).toContain('out of memory');
    expect(result.text).toBe('');
  });

  test('an unknown model is a 404, like the real daemon', async () => {
    const server = fake('fake-smart');
    const result = await call(server, 'not-pulled:1b', PASS_CASE);

    expect(result.status).toBe(404);
    expect(result.error).toContain('not found');
  });
});

describe('residency and unloading', () => {
  test('a chat call makes the model resident with its declared size', async () => {
    const server = fake('fake-smart');
    expect(server.resident()).toEqual([]);

    await call(server, 'fake-smart', PASS_CASE);
    expect(server.resident()).toEqual(['fake-smart']);

    const entries = await listResident(server.url);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sizeBytes).toBe(Math.round(7.5 * 1024 ** 3));
  });

  test('keep_alive 0 unloads, which is how the bench frees RAM between models', async () => {
    const server = fake('fake-smart', { seedResident: true });
    expect(server.resident()).toEqual(['fake-smart']);

    const unloaded = await unloadModel(server.url, 'fake-smart');

    expect(unloaded).toBe(true);
    expect(server.resident()).toEqual([]);
    const generate = server.requests.find((r) => r.path === '/api/generate');
    expect(generate?.body.keep_alive).toBe(0);
  });

  test('an unloaded model reports no resident size', async () => {
    const server = fake('fake-smart');
    const entries = await listResident(server.url);
    expect(entries).toEqual([]);
  });
});
