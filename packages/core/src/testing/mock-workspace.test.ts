import { describe, expect, test } from 'bun:test';
import { MockWorkspace } from './mock-workspace';

describe('MockWorkspace', () => {
  test('creates a worktree from a ref and tracks changed files', async () => {
    const ws = new MockWorkspace({ 'src/main.ts': 'export const app = 1;' });
    const { path, branch } = await ws.create('/repo', 'starling/abc/theme', 'main');
    expect(branch).toBe('starling/abc/theme');
    expect(await ws.changedFiles(path, 'main')).toEqual([]);

    ws.writeFile(path, 'src/main.ts', 'export const app = 2;');
    ws.writeFile(path, 'src/theme.ts', 'export const theme = "dark";');
    expect(await ws.changedFiles(path, 'main')).toEqual(['src/main.ts', 'src/theme.ts']);
  });

  test('diff reports added and removed lines per file', async () => {
    const ws = new MockWorkspace({ 'src/main.ts': 'a\nb\n' });
    const { path } = await ws.create('/repo', 'starling/abc/theme', 'main');
    ws.writeFile(path, 'src/main.ts', 'a\nc\nd\n');
    const diff = await ws.diff(path, 'main');
    expect(diff.files).toEqual([{ path: 'src/main.ts', added: 2, removed: 1 }]);
    expect(diff.truncated).toBe(false);
  });

  test('commitAll returns undefined for a clean worktree and a sha otherwise', async () => {
    const ws = new MockWorkspace({ 'src/main.ts': 'one' });
    const { path } = await ws.create('/repo', 'starling/abc/theme', 'main');
    expect(await ws.commitAll(path, 'empty')).toBeUndefined();
    ws.writeFile(path, 'src/main.ts', 'two');
    expect(await ws.commitAll(path, 'feat: theme')).toBe('mock-commit-1');
    expect(await ws.commitAll(path, 'again')).toBeUndefined();
  });

  test('committing promotes files to the branch so a later worktree sees them', async () => {
    const ws = new MockWorkspace({ 'src/main.ts': 'one' });
    const first = await ws.create('/repo', 'starling/abc/theme', 'main');
    await ws.ensureIntegrationBranch('/repo', 'main', 'starling/abc/integration');
    ws.writeFile(first.path, 'src/theme.ts', 'dark');
    await ws.commitAll(first.path, 'theme');
    expect(await ws.changedFiles(first.path, 'main')).toEqual(['src/theme.ts']);
  });

  test('predictConflicts is scripted per branch pair, both directions', async () => {
    const ws = new MockWorkspace();
    ws.setConflict('ours', 'theirs', ['src/ui/styles.css']);
    expect(await ws.predictConflicts('/repo', 'ours', 'theirs')).toEqual(['src/ui/styles.css']);
    expect(await ws.predictConflicts('/repo', 'theirs', 'ours')).toEqual(['src/ui/styles.css']);
    expect(await ws.predictConflicts('/repo', 'a', 'b')).toEqual([]);
  });

  test('remove deletes the worktree and records it', async () => {
    const ws = new MockWorkspace();
    const { path } = await ws.create('/repo', 'starling/abc/theme', 'main');
    await ws.remove(path);
    expect(ws.worktrees.has(path)).toBe(false);
    expect(ws.removed).toEqual([path]);
    expect(await ws.changedFiles(path, 'main').catch((e) => String(e))).toContain('unknown worktree');
  });

  test('creating from an unknown ref fails loudly', async () => {
    const ws = new MockWorkspace();
    await expect(ws.create('/repo', 'branch', 'nope')).rejects.toThrow('unknown ref');
  });
});
