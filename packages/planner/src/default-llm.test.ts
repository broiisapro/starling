import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isStarlingError } from '@starling/core';
import { MockLLM, makeGoal } from '@starling/core/testing';
import { discoverOpencodeService, serviceFileCandidates } from './default-llm';
import { createPlanner } from './planner';
import { loadDraftFixture, loadRepoMapFixture } from './test-fixtures';

function fakeHome(files: Record<string, string>): string {
  const home = mkdtempSync(join(tmpdir(), 'starling-planner-llm-'));
  for (const [relative, content] of Object.entries(files)) {
    const path = join(home, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return home;
}

describe('discoverOpencodeService', () => {
  test('an explicit URL and password win over service.json', () => {
    const service = discoverOpencodeService(
      { STARLING_OPENCODE_URL: 'http://127.0.0.1:5000', OPENCODE_SERVER_PASSWORD: 'pw' },
      fakeHome({ '.local/state/opencode/service.json': '{"url":"http://127.0.0.1:1"}' }),
    );
    expect(service).toEqual({ url: 'http://127.0.0.1:5000', password: 'pw' });
  });

  test('reads url and password from the running CLI service file', () => {
    const home = fakeHome({
      '.local/state/opencode/service.json': '{"url":"http://127.0.0.1:49374","password":"secret"}',
    });
    expect(discoverOpencodeService({}, home)).toEqual({
      url: 'http://127.0.0.1:49374',
      password: 'secret',
    });
  });

  test('falls back to the config path and survives a half-written file', () => {
    const home = fakeHome({
      '.local/state/opencode/service.json': '{"url":',
      '.config/opencode/service.json': '{"url":"http://127.0.0.1:7777"}',
    });
    expect(discoverOpencodeService({}, home)).toEqual({ url: 'http://127.0.0.1:7777' });
  });

  test('returns undefined when nothing is configured', () => {
    expect(discoverOpencodeService({}, fakeHome({}))).toBeUndefined();
    expect(serviceFileCandidates('/home/x')).toEqual([
      '/home/x/.local/state/opencode/service.json',
      '/home/x/.config/opencode/service.json',
    ]);
  });
});

describe('createPlanner without an explicit LLM', () => {
  test('is constructible: the model can be resolved from the environment later', () => {
    const planner = createPlanner({});
    expect(typeof planner.plan).toBe('function');
    expect(typeof planner.validate).toBe('function');
  });

  test('resolving a bad STARLING_LLM_PROFILE fails before any request is made', async () => {
    const previous = process.env.STARLING_LLM_PROFILE;
    process.env.STARLING_LLM_PROFILE = 'definitely-not-a-profile';
    try {
      const planner = createPlanner({});
      const error = await planner.plan(makeGoal(), loadRepoMapFixture()).catch((err: unknown) => err);
      expect(isStarlingError(error, 'CONFIG_INVALID')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.STARLING_LLM_PROFILE;
      else process.env.STARLING_LLM_PROFILE = previous;
    }
  });

  test('an injected LLM wins and is used once per turn', async () => {
    const llm = new MockLLM({ responses: [{ text: JSON.stringify(loadDraftFixture()) }] });
    const planner = createPlanner({ llm, maxRepairs: 0 });
    const { plan } = await planner.plan(makeGoal(), loadRepoMapFixture());
    expect(plan.tasks).toHaveLength(7);
    expect(llm.calls).toHaveLength(1);
  });
});
