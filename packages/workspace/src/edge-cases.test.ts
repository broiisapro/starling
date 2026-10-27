/**
 * Edge cases the swarm actually meets: submodules, LFS pointer files, spaces and unicode in paths,
 * a detached-HEAD base, and a dirty main checkout.
 *
 * Every case uses a real repository under the OS temp dir (no network: the submodule is a local path
 * and the LFS "pointer" is just the text git-lfs would store in the tree).
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec as coreExec, type ExecResult, isStarlingError } from '@starling/core';
import { PATCH_LIMIT_BYTES, UNTRACKED_MAX_BYTES } from './diff.ts';
import { normalizeKey } from './repo.ts';
import { commitFile, git, initRepo, makeTempDir, removeDirs, writeFileIn } from './testing/temp-repo.ts';
import { createWorkspace, type WorkspaceWithBundles } from './workspace.ts';

/** `git` with extra `-c` options (used for `protocol.file.allow=always` on local submodules). */
async function gitWith(cwd: string, config: string[], ...args: string[]): Promise<string> {
  const result: ExecResult = await coreExec(['git', ...config, ...args], { cwd });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.code}): ${result.stderr}`);
  }
  return result.stdout;
}

async function withRoot<T>(prefix: string, fn: (root: string) => Promise<T>): Promise<T> {
  const root = await makeTempDir(prefix);
  try {
    return await fn(root);
  } finally {
    await removeDirs(root);
  }
}

/** Create a repo plus a workspace rooted beside it. */
async function fixture(
  root: string,
  repoName = 'repo',
  worktreeName = 'worktrees',
): Promise<{ repo: string; worktreeRoot: string; ws: WorkspaceWithBundles }> {
  const repo = await initRepo(join(root, repoName));
  const worktreeRoot = normalizeKey(join(root, worktreeName));
  return { repo, worktreeRoot, ws: createWorkspace({ worktreeRoot }) };
}

describe('spaces and unicode in paths', () => {
  test('creates, diffs and removes a worktree in a unicode repo path with unicode files', async () => {
    await withRoot('starling-edge-unicode-', async (root) => {
      const repo = await initRepo(join(root, 'my répo with spaces'));
      const worktreeRoot = join(root, 'wörk trees ünïcode');
      const ws = createWorkspace({ worktreeRoot });

      const { path, branch } = await ws.create(repo, 'starling/run-1/t01-café', 'main');

      expect(branch).toBe('starling/run-1/t01-café');
      expect(path.startsWith(normalizeKey(worktreeRoot))).toBe(true);
      expect(existsSync(join(path, 'README.md'))).toBe(true);

      await writeFileIn(path, 'src/naïve file.ts', 'export const café = 1;\n');
      const sha = await ws.commitAll(path, 'feat: unicode file');
      expect(sha).toBeDefined();

      const summary = await ws.diff(path, 'main');
      expect(summary.files.map((file) => file.path)).toContain('src/naïve file.ts');
      expect(summary.patch).toContain('+export const café = 1;');
      expect(await ws.changedFiles(path, 'main')).toContain('src/naïve file.ts');

      await ws.remove(path);
      expect(existsSync(path)).toBe(false);
      expect((await git(repo, 'worktree', 'list')).includes('wörk trees ünïcode')).toBe(false);
    });
  }, 20_000);

  test('an untracked file with a space and a newline never breaks the untracked scan', async () => {
    await withRoot('starling-edge-spacefile-', async (root) => {
      const { repo, ws } = await fixture(root, 'repo with space');
      const { path } = await ws.create(repo, 'starling/run-1/t01', 'main');
      await writeFileIn(path, 'odd name.txt', 'hello\n');
      await writeFileIn(path, 'new\nline.txt', 'hello\n');

      const files = await ws.changedFiles(path, 'main');
      expect(files).toContain('odd name.txt');
      expect(files).toContain('new\nline.txt');
    });
  }, 20_000);
});

describe('a detached HEAD base', () => {
  test('creates a worktree from a commit sha while the main checkout is detached', async () => {
    await withRoot('starling-edge-detached-', async (root) => {
      const { repo, ws } = await fixture(root);
      const sha = (await git(repo, 'rev-parse', 'main')).trim();
      await commitFile(repo, 'later.txt', 'later\n', 'later commit');
      const head = (await git(repo, 'rev-parse', 'HEAD')).trim();
      await git(repo, 'checkout', '--detach', sha);

      const { path } = await ws.create(repo, 'starling/run-1/t01-detached', sha);

      // The task starts at the requested commit, not at the newer commit on main.
      expect((await git(path, 'rev-parse', 'HEAD')).trim()).toBe(sha);
      expect(existsSync(join(path, 'later.txt'))).toBe(false);
      expect((await git(path, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe(
        'starling/run-1/t01-detached',
      );
      expect(head).not.toBe(sha);
    });
  }, 20_000);

  test('accepts the literal HEAD as a base for the integration branch', async () => {
    await withRoot('starling-edge-head-base-', async (root) => {
      const { repo, ws } = await fixture(root);
      await git(repo, 'checkout', '--detach', 'HEAD');

      await ws.ensureIntegrationBranch(repo, 'HEAD', 'starling/run-1/integration');

      expect((await git(repo, 'rev-parse', 'starling/run-1/integration')).trim()).toBe(
        (await git(repo, 'rev-parse', 'HEAD')).trim(),
      );
    });
  }, 20_000);

  test('a commit sha base is exempt from the dirty-checkout guard', async () => {
    await withRoot('starling-edge-sha-dirty-', async (root) => {
      const { repo, ws } = await fixture(root);
      const sha = (await git(repo, 'rev-parse', 'main')).trim();
      await writeFileIn(repo, 'README.md', '# dirty\n');

      await ws.ensureIntegrationBranch(repo, sha, 'starling/run-1/integration');

      expect((await git(repo, 'rev-parse', 'starling/run-1/integration')).trim()).toBe(sha);
    });
  }, 20_000);
});

describe('a dirty main checkout', () => {
  test('refuses to start the integration branch and says why', async () => {
    await withRoot('starling-edge-dirty-', async (root) => {
      const { repo, ws } = await fixture(root);
      await writeFileIn(repo, 'README.md', '# half-finished edit\n');
      await writeFileIn(repo, 'src/unstaged.ts', 'export const x = 1;\n');

      try {
        await ws.ensureIntegrationBranch(repo, 'main', 'starling/run-1/integration');
        throw new Error('expected a throw');
      } catch (err) {
        expect(isStarlingError(err, 'WORKSPACE_ERROR')).toBe(true);
        expect((err as Error).message).toContain('refusing to start the integration branch');
        expect((err as Error).message).toContain('uncommitted changes');
        expect((err as { details?: { reason?: string } }).details?.reason).toBe('dirty-base-checkout');
      }
      // Nothing was created while refusing.
      expect((await git(repo, 'branch', '--list', 'starling/run-1/integration')).trim()).toBe('');
    });
  }, 20_000);

  test('a staged delete also counts as dirty', async () => {
    await withRoot('starling-edge-dirty-staged-', async (root) => {
      const { repo, ws } = await fixture(root);
      await git(repo, 'rm', '-q', 'README.md');

      await expect(ws.ensureIntegrationBranch(repo, 'main', 'starling/run-1/integration')).rejects.toThrow(
        /uncommitted changes/,
      );
    });
  }, 20_000);

  test('untracked files alone do not block a run', async () => {
    await withRoot('starling-edge-untracked-', async (root) => {
      const { repo, ws } = await fixture(root);
      await writeFileIn(repo, 'scratch.log', 'noise\n');
      await writeFileIn(repo, 'notes/idea.md', 'untracked\n');

      await ws.ensureIntegrationBranch(repo, 'main', 'starling/run-1/integration');

      expect((await git(repo, 'rev-parse', 'starling/run-1/integration')).trim()).toBe(
        (await git(repo, 'rev-parse', 'main')).trim(),
      );
    });
  }, 20_000);
});

describe('submodules', () => {
  test('worktree lifecycle works and never initialises the submodule', async () => {
    await withRoot('starling-edge-submodule-', async (root) => {
      const lib = await initRepo(join(root, 'lib'));
      const repo = await initRepo(join(root, 'app'));
      await gitWith(
        repo,
        ['-c', 'protocol.file.allow=always'],
        'submodule',
        'add',
        '-q',
        lib,
        'vendor/lib',
      );
      await git(repo, 'commit', '-qm', 'add submodule');
      const ws = createWorkspace({ worktreeRoot: join(root, 'worktrees') });

      const { path } = await ws.create(repo, 'starling/run-1/t01-sub', 'main');

      // Documented limit: the submodule path exists as a gitlink only; its content is not checked out.
      const gitlink = (await git(path, 'ls-files', '-s', 'vendor/lib')).trim();
      expect(gitlink.startsWith('160000')).toBe(true);
      expect(existsSync(join(path, 'vendor/lib/lib.txt'))).toBe(false);

      // Normal work in the parent repo is unaffected, with or without touching the submodule path.
      await writeFileIn(path, 'src/app.ts', 'export const app = 1;\n');
      const sha = await ws.commitAll(path, 'feat: parent-only change');
      expect(sha).toBeDefined();

      const summary = await ws.diff(path, 'main');
      expect(summary.files.map((file) => file.path)).toContain('src/app.ts');
      expect(summary.files.some((file) => file.path.startsWith('vendor/lib'))).toBe(false);

      await ws.remove(path);
      expect(existsSync(path)).toBe(false);
    });
  }, 30_000);

  test('a submodule bump shows up as a single changed path, not as file contents', async () => {
    await withRoot('starling-edge-submodule-bump-', async (root) => {
      const lib = await initRepo(join(root, 'lib'));
      const repo = await initRepo(join(root, 'app'));
      await gitWith(
        repo,
        ['-c', 'protocol.file.allow=always'],
        'submodule',
        'add',
        '-q',
        lib,
        'vendor/lib',
      );
      await git(repo, 'commit', '-qm', 'add submodule');
      const ws = createWorkspace({ worktreeRoot: join(root, 'worktrees') });
      const { path } = await ws.create(repo, 'starling/run-1/t01-sub', 'main');

      // Bump the gitlink by hand (the same object id movement `submodule update` would produce).
      const newSha = (await git(path, 'rev-parse', 'HEAD')).trim();
      await git(path, 'update-index', '--cacheinfo', `160000,${newSha},vendor/lib`);
      await git(path, 'commit', '-qm', 'bump submodule');

      const summary = await ws.diff(path, 'main');
      expect(summary.files.map((file) => file.path)).toEqual(['vendor/lib']);
      expect(summary.patch.length).toBeLessThan(2000);
    });
  }, 30_000);
});

describe('LFS pointer files', () => {
  const POINTER = [
    'version https://git-lfs.github.com/spec/v1',
    'oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393',
    'size 123456789',
    '',
  ].join('\n');

  test('a pointer file diffs as three lines and never pulls content', async () => {
    await withRoot('starling-edge-lfs-', async (root) => {
      const repo = await initRepo(join(root, 'repo'));
      await writeFileIn(
        repo,
        '.gitattributes',
        '*.bin filter=lfs diff=lfs merge=lfs -text\n*.png filter=lfs diff=lfs merge=lfs -text\n',
      );
      await writeFileIn(repo, 'assets/logo.png', POINTER);
      await writeFileIn(repo, 'assets/data.bin', POINTER);
      await git(repo, 'add', '-A');
      await git(repo, 'commit', '-qm', 'lfs pointers');
      const ws = createWorkspace({ worktreeRoot: join(root, 'worktrees') });
      const { path } = await ws.create(repo, 'starling/run-1/t01-lfs', 'main');

      // A pointer rewrite is a three-line text change, whatever the real object size is.
      await writeFileIn(
        path,
        'assets/logo.png',
        POINTER.replace('size 123456789', 'size 987654321'),
      );
      const summary = await ws.diff(path, 'main');

      expect(summary.files).toEqual([{ path: 'assets/logo.png', added: 1, removed: 1 }]);
      expect(summary.truncated).toBe(false);
      expect(summary.patch.length).toBeLessThan(2000);
      expect(summary.patch).toContain('size 987654321');

      // The commit lands normally, and a second commit has nothing to do.
      expect(await ws.commitAll(path, 'chore: relink lfs pointer')).toBeDefined();
      expect(await ws.commitAll(path, 'again')).toBeUndefined();
      expect((await git(path, 'status', '--porcelain')).trim()).toBe('');
    });
  }, 20_000);

  test('an LFS-sized untracked blob is counted as 0/0 without inflating the patch', async () => {
    await withRoot('starling-edge-lfs-huge-', async (root) => {
      const repo = await initRepo(join(root, 'repo'));
      await writeFileIn(repo, '.gitattributes', '*.bin filter=lfs diff=lfs merge=lfs -text\n');
      await git(repo, 'add', '-A');
      await git(repo, 'commit', '-qm', 'attributes');
      const ws = createWorkspace({ worktreeRoot: join(root, 'worktrees') });
      const { path } = await ws.create(repo, 'starling/run-1/t01-lfs', 'main');

      const bytes = Buffer.alloc(UNTRACKED_MAX_BYTES + 1024, 0x41);
      await mkdir(join(path, 'assets'), { recursive: true });
      await writeFile(join(path, 'assets/huge.bin'), bytes);
      expect((await stat(join(path, 'assets/huge.bin'))).size).toBeGreaterThan(UNTRACKED_MAX_BYTES);

      const summary = await ws.diff(path, 'main');

      expect(summary.files).toEqual([{ path: 'assets/huge.bin', added: 0, removed: 0 }]);
      expect(Buffer.byteLength(summary.patch, 'utf8')).toBeLessThanOrEqual(PATCH_LIMIT_BYTES);
      expect(summary.patch).not.toContain('AAAA');
    });
  }, 30_000);
});
