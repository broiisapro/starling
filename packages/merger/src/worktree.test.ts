import { afterAll, describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from '@starling/core';
import {
  canonicalPath,
  createGit,
  ensureIntegrationWorktree,
  integrationWorktreePath,
  listWorktrees,
  sanitizeBranchName,
} from './index.ts';
import { cleanupTempDirs, createIntegrationBranch, git, makeRepo } from './test-helpers.ts';

afterAll(cleanupTempDirs);

const gitClient = createGit(exec);
const INTEGRATION = 'starling/run1/integration';

describe('integration worktree paths', () => {
  test('sanitises branch names into safe directory names', () => {
    expect(sanitizeBranchName('starling/abc123/integration')).toBe('starling-abc123-integration');
    expect(sanitizeBranchName('epic/17-merger')).toBe('epic-17-merger');
    expect(sanitizeBranchName('  //weird//  ')).toBe('weird');
    expect(sanitizeBranchName('release/1.2.3')).toBe('release-1.2.3');
    expect(sanitizeBranchName('')).toBe('integration');
  });

  test('lays out <worktreeRoot>/_integration/<branch>', () => {
    expect(integrationWorktreePath('/tmp/worktrees', INTEGRATION)).toBe(
      '/tmp/worktrees/_integration/starling-run1-integration',
    );
  });

  test('canonicalPath resolves symlinks for paths that do not exist yet', () => {
    const resolved = canonicalPath(join(tmpdir(), 'starling-merger-not-created', 'nested'));
    expect(resolved).toBe(join(realpathSync(tmpdir()), 'starling-merger-not-created', 'nested'));
  });
});

describe('ensureIntegrationWorktree', () => {
  test('creates the worktree on first use and reuses it afterwards', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createIntegrationBranch(repo, INTEGRATION);
    const root = canonicalPath(worktreeRoot);

    const first = await ensureIntegrationWorktree({
      repo,
      integrationBranch: INTEGRATION,
      worktreeRoot: root,
      git: gitClient,
    });
    const second = await ensureIntegrationWorktree({
      repo,
      integrationBranch: INTEGRATION,
      worktreeRoot: root,
      git: gitClient,
    });

    expect(first).toBe(integrationWorktreePath(root, INTEGRATION));
    expect(second).toBe(first);
    expect(await git(first, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(INTEGRATION);
    const worktrees = await listWorktrees(gitClient, repo);
    expect(worktrees.filter((worktree) => worktree.path === first)).toHaveLength(1);
    expect(worktrees).toHaveLength(2);
  });

  test('returns a detached integration worktree to its branch', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createIntegrationBranch(repo, INTEGRATION);
    const root = canonicalPath(worktreeRoot);
    const path = await ensureIntegrationWorktree({
      repo,
      integrationBranch: INTEGRATION,
      worktreeRoot: root,
      git: gitClient,
    });

    await git(path, ['checkout', '--quiet', '--detach']);
    const again = await ensureIntegrationWorktree({
      repo,
      integrationBranch: INTEGRATION,
      worktreeRoot: root,
      git: gitClient,
    });

    expect(again).toBe(path);
    expect(await git(path, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(INTEGRATION);
  });

  test('refuses a directory it does not own at the integration path', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createIntegrationBranch(repo, INTEGRATION);
    const root = canonicalPath(worktreeRoot);
    const path = integrationWorktreePath(root, INTEGRATION);
    await mkdir(path, { recursive: true });

    await expect(
      ensureIntegrationWorktree({
        repo,
        integrationBranch: INTEGRATION,
        worktreeRoot: root,
        git: gitClient,
      }),
    ).rejects.toMatchObject({ code: 'MERGE_ERROR' });
  });

  test('refuses to hijack a worktree that is on another branch', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createIntegrationBranch(repo, INTEGRATION);
    await git(repo, ['branch', 'some/other-branch', 'main']);
    const root = canonicalPath(worktreeRoot);
    const path = await ensureIntegrationWorktree({
      repo,
      integrationBranch: INTEGRATION,
      worktreeRoot: root,
      git: gitClient,
    });
    await git(path, ['checkout', '--quiet', 'some/other-branch']);

    await expect(
      ensureIntegrationWorktree({
        repo,
        integrationBranch: INTEGRATION,
        worktreeRoot: root,
        git: gitClient,
      }),
    ).rejects.toMatchObject({ code: 'MERGE_ERROR' });
  });

  test('reports a missing integration branch instead of creating one', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    const root = canonicalPath(worktreeRoot);

    await expect(
      ensureIntegrationWorktree({
        repo,
        integrationBranch: INTEGRATION,
        worktreeRoot: root,
        git: gitClient,
      }),
    ).rejects.toMatchObject({ code: 'MERGE_ERROR' });
  });
});
