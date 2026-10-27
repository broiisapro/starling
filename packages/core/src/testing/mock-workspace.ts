import type { DiffSummary } from '../contracts';
import { StarlingError } from '../errors';
import type { Workspace } from '../ports';

interface MockWorktree {
  branch: string;
  fromRef: string;
  files: Map<string, string>;
  committed: Array<{ sha: string; message: string; files: string[] }>;
}

/**
 * In-memory `Workspace` double: branches are file maps and worktrees are cheap copies.
 *
 * Enough fidelity for engine tests (create → edit → diff → commit → merge/remove) without touching
 * git. `conflicts` lets a test script `predictConflicts` for a branch pair.
 */
export class MockWorkspace implements Workspace {
  readonly branches = new Map<string, { fromRef: string; files: Map<string, string> }>();
  readonly worktrees = new Map<string, MockWorktree>();
  readonly conflicts = new Map<string, string[]>();
  readonly removed: string[] = [];
  #commits = 0;

  constructor(branches: Record<string, string> = {}) {
    this.branches.set('main', { fromRef: 'main', files: new Map(Object.entries(branches)) });
  }

  async ensureIntegrationBranch(_repo: string, base: string, name: string): Promise<void> {
    if (!this.branches.has(name)) {
      const baseBranch = this.branches.get(base);
      this.branches.set(name, {
        fromRef: base,
        files: new Map(baseBranch ? baseBranch.files : []),
      });
    }
  }

  async create(_repo: string, branch: string, fromRef: string): Promise<{ path: string; branch: string }> {
    const parent = this.branches.get(fromRef);
    if (parent === undefined) {
      throw new StarlingError('WORKSPACE_ERROR', `MockWorkspace: unknown ref ${fromRef}`);
    }
    const files = new Map(parent.files);
    this.branches.set(branch, { fromRef, files: new Map(files) });
    const path = `/mock/worktrees/${branch.replace(/\//g, '-')}`;
    this.worktrees.set(path, { branch, fromRef, files, committed: [] });
    return { path, branch };
  }

  /** Test helper: write a file in a mock worktree. */
  writeFile(worktreePath: string, path: string, content: string): void {
    const wt = this.#get(worktreePath);
    wt.files.set(path, content);
  }

  /** Test helper: script the conflicted files for `ours` x `theirs`. */
  setConflict(ours: string, theirs: string, files: string[]): void {
    this.conflicts.set(`${ours}..${theirs}`, files);
    this.conflicts.set(`${theirs}..${ours}`, files);
  }

  async diff(worktreePath: string, _baseRef: string): Promise<DiffSummary> {
    const wt = this.#get(worktreePath);
    const files: DiffSummary['files'] = [];
    const patchParts: string[] = [];
    for (const [path, content] of wt.files) {
      const base = this.branches.get(wt.fromRef)?.files.get(path);
      if (base === content) continue;
      const added = base === undefined ? content.split('\n').length : countAdded(base, content);
      const removed = base === undefined ? 0 : countRemoved(base, content);
      files.push({ path, added, removed });
      patchParts.push(`--- a/${path}\n+++ b/${path}\n${content}`);
    }
    return { files, patch: patchParts.join('\n'), truncated: false };
  }

  async changedFiles(worktreePath: string, _baseRef: string): Promise<string[]> {
    const wt = this.#get(worktreePath);
    const out: string[] = [];
    for (const [path, content] of wt.files) {
      if (this.branches.get(wt.fromRef)?.files.get(path) !== content) out.push(path);
    }
    return out.sort();
  }

  async predictConflicts(_repo: string, ours: string, theirs: string): Promise<string[]> {
    return [...(this.conflicts.get(`${ours}..${theirs}`) ?? [])];
  }

  async commitAll(worktreePath: string, message: string): Promise<string | undefined> {
    const wt = this.#get(worktreePath);
    const branch = this.branches.get(wt.branch);
    if (branch === undefined) throw new StarlingError('WORKSPACE_ERROR', `MockWorkspace: unknown branch`);
    const changed = [...wt.files.entries()].filter(([path, content]) => branch.files.get(path) !== content);
    if (changed.length === 0) return undefined;
    for (const [path, content] of changed) branch.files.set(path, content);
    this.#commits += 1;
    const sha = `mock-commit-${this.#commits}`;
    wt.committed.push({ sha, message, files: changed.map(([path]) => path) });
    return sha;
  }

  async remove(worktreePath: string): Promise<void> {
    this.worktrees.delete(worktreePath);
    this.removed.push(worktreePath);
  }

  #get(worktreePath: string): MockWorktree {
    const wt = this.worktrees.get(worktreePath);
    if (wt === undefined) {
      throw new StarlingError('WORKSPACE_ERROR', `MockWorkspace: unknown worktree ${worktreePath}`);
    }
    return wt;
  }
}

function countAdded(before: string, after: string): number {
  const oldLines = new Set(before.split('\n'));
  return after.split('\n').filter((line) => !oldLines.has(line)).length;
}

function countRemoved(before: string, after: string): number {
  const newLines = new Set(after.split('\n'));
  return before.split('\n').filter((line) => !newLines.has(line)).length;
}
