import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isInside, REPLAY_ROOT_NAMES, resolveReplayPath } from './replay-paths';

const roots = ['/repo/fixtures', '/repo/.starling'];

describe('resolveReplayPath', () => {
  test('allows files under either allowed root', () => {
    expect(resolveReplayPath('/repo/fixtures/runs/one.jsonl', roots, '/repo').ok).toBe(true);
    expect(resolveReplayPath('.starling/runs/two.jsonl', roots, '/repo').ok).toBe(true);
  });

  test('resolves relative paths against the repo root', () => {
    const decision = resolveReplayPath('fixtures/a.jsonl', roots, '/repo');
    expect(decision).toEqual({ ok: true, path: '/repo/fixtures/a.jsonl' });
  });

  test('rejects absolute paths outside the roots', () => {
    expect(resolveReplayPath('/etc/passwd', roots, '/repo').ok).toBe(false);
    expect(resolveReplayPath('/repo/package.json', roots, '/repo').ok).toBe(false);
  });

  test('rejects traversal back out of a root', () => {
    expect(resolveReplayPath('fixtures/../../etc/passwd', roots, '/repo').ok).toBe(false);
    expect(resolveReplayPath('fixtures/../package.json', roots, '/repo').ok).toBe(false);
  });

  test('rejects a sibling whose name merely shares the prefix', () => {
    expect(isInside('/repo/fixtures', '/repo/fixtures-other/a.jsonl')).toBe(false);
    expect(isInside('/repo/fixtures', '/repo/fixtures/a.jsonl')).toBe(true);
  });

  test('rejects an empty path', () => {
    const decision = resolveReplayPath('   ', roots, '/repo');
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain('empty');
  });

  test('a symlink out of fixtures is rejected after realpath', () => {
    const dir = mkdtempSync(join(tmpdir(), 'starling-replay-'));
    try {
      const fixtures = join(dir, REPLAY_ROOT_NAMES[0]);
      mkdirSync(fixtures, { recursive: true });
      const secret = join(dir, 'secret.jsonl');
      writeFileSync(secret, '{}\n');
      const link = join(fixtures, 'escape.jsonl');
      symlinkSync(secret, link);
      const decision = resolveReplayPath(link, [fixtures], dir);
      expect(decision.ok).toBe(false);
      expect(decision.reason).toContain('fixtures');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
