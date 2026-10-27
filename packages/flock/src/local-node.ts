import { mkdir, stat } from 'node:fs/promises';
import { arch, availableParallelism, cpus, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import type {
  AgentEvent,
  AgentRunner,
  Clock,
  ExecutionNode,
  NodeInfo,
  StartTaskOptions,
  TaskHandle,
  Workspace,
} from '@starling/core';
import { exec as coreExec, StarlingError, systemClock } from '@starling/core';
import type { BundleOps } from './bundle-ops';
import { bundleFileName } from './bundle-ops';
import { requestBytes } from './http';

export interface LocalNodeOptions {
  /** `'hub'` on the machine running `starling run`; a perch uses its own id. */
  id?: string;
  name: string;
  workspace: Workspace & Partial<BundleOps>;
  runner: AgentRunner;
  maxSessions: number;
  /** Root for worktrees; bundle cache repos and incoming bundles live underneath it. */
  worktreeRoot: string;
  clock?: Clock;
  /** Extra/overriding NodeInfo fields (local models, platform quirks, a display name). */
  infoProvider?: () => Partial<NodeInfo>;
  /** Injected for the same reason `fetch` is injected everywhere: tests never touch a socket. */
  fetch?: typeof fetch;
  /** Where downloaded and produced bundles land. Defaults to `<worktreeRoot>/_bundles`. */
  bundleDir?: string;
  /** Where bundle-sourced tasks keep their cache clone. Defaults to `<worktreeRoot>/_repos`. */
  repoCacheDir?: string;
  downloadTimeoutMs?: number;
  /** Override the git-head lookup used when the agent committed nothing. */
  headSha?: (dir: string) => Promise<string | undefined>;
}

/** A `LocalNode` is just an `ExecutionNode` plus the knobs a perch daemon needs to shut it down. */
export interface LocalNode extends ExecutionNode {
  readonly worktreeRoot: string;
  activeSessions(): number;
  /** Stop listening to the runner and abort any live sessions. Idempotent. */
  close(): Promise<void>;
}

interface LocalTask {
  handle: TaskHandle;
  opts: StartTaskOptions;
  /** Repo the worktree was created from (the hub repo, or a bundle cache clone). */
  repoPath: string;
  worktreePath: string;
  fromBundle: boolean;
  /** Where `collect` should write the result bundle for a bundle-sourced task. */
  resultBundlePath?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    // Missing is the expected miss; a permission error will resurface from git with a better message.
    return false;
  }
}

async function gitHead(dir: string): Promise<string | undefined> {
  const res = await coreExec(['git', 'rev-parse', 'HEAD'], { cwd: dir, timeoutMs: 10_000 });
  return res.code === 0 ? res.stdout.trim() : undefined;
}

/**
 * The node that runs agents on this machine: `Workspace` + `AgentRunner` (ARCHITECTURE L20).
 *
 * `startTask` prepares a worktree from either the hub's own repo (`kind:'local'`) or a git bundle sent
 * by the hub (`kind:'bundle'`). Everything else — audit and merge — stays on the hub, so this node only
 * has to hand back a commit, a diff and (for perches) a result bundle.
 *
 * Capacity is tracked here rather than by the registry: `info().activeSessions` is the number of live
 * sessions, which is what the scheduler reads. `maxSessions` is the machine's own promise about how many
 * simultaneous opencode sessions it can survive.
 */
export function createLocalNode(options: LocalNodeOptions): LocalNode {
  const clock = options.clock ?? systemClock;
  const id = options.id ?? 'hub';
  const bundleDir = options.bundleDir ?? join(options.worktreeRoot, '_bundles');
  const repoCacheDir = options.repoCacheDir ?? join(options.worktreeRoot, '_repos');
  const fetchFn = options.fetch ?? fetch;
  const tasks = new Map<string, LocalTask>();
  const sessionToTask = new Map<string, string>();
  const listeners = new Set<(event: AgentEvent) => void>();

  const unsubscribeRunner = options.runner.onEvent((event) => {
    // Re-emit only sessions this node started. A shared runner (one `opencode serve` on the hub) also
    // hosts sessions from other nodes; without this filter every node would claim every event.
    if (!sessionToTask.has(event.sessionId)) return;
    for (const listener of [...listeners]) listener(event);
  });

  const taskId = (runId: string, taskKey: string): string => `${runId}/${taskKey}`;

  const requireTask = (handle: TaskHandle): LocalTask => {
    const task = tasks.get(taskId(handle.runId, handle.taskKey));
    if (task === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', `Node ${id} has no task ${handle.taskKey}`, {
        details: { runId: handle.runId, sessionId: handle.sessionId },
      });
    }
    return task;
  };

  const info = async (): Promise<NodeInfo> => {
    const activeSessions = tasks.size;
    return {
      id,
      name: options.name,
      kind: 'local',
      platform: platform(),
      arch: arch(),
      cpuCores: availableParallelism?.() ?? cpus().length,
      memGb: Math.round(totalmem() / 1024 ** 3),
      maxSessions: options.maxSessions,
      localModels: [],
      latencyMs: 0,
      ...options.infoProvider?.(),
      activeSessions,
      status: activeSessions > 0 ? 'busy' : 'online',
      lastSeen: clock.now(),
    };
  };

  const prepareRepo = async (
    opts: StartTaskOptions,
  ): Promise<{ repoPath: string; resultBundlePath?: string }> => {
    if (opts.repo.kind === 'local') return { repoPath: opts.repo.path };

    const { cloneFromBundle, fetchBundle, createBundle } = options.workspace;
    if (cloneFromBundle === undefined || fetchBundle === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', 'LocalNode needs BundleOps to accept a bundle task');
    }

    await mkdir(bundleDir, { recursive: true });
    const incomingPath = join(
      bundleDir,
      `${bundleFileName(opts.runId)}-${bundleFileName(opts.taskKey)}.bundle`,
    );
    const bytes = await requestBytes(
      opts.repo.url,
      { method: 'GET' },
      { fetch: fetchFn, token: opts.repo.token, timeoutMs: options.downloadTimeoutMs },
    );
    await Bun.write(incomingPath, bytes);

    const cacheRepo = join(repoCacheDir, bundleFileName(opts.runId));
    if (await exists(cacheRepo)) {
      // The cache clone is per run, so a later task in the same run sees an updated integration branch.
      await fetchBundle(cacheRepo, incomingPath, opts.fromRef, opts.fromRef);
    } else {
      await mkdir(repoCacheDir, { recursive: true });
      await cloneFromBundle(incomingPath, cacheRepo, opts.fromRef);
    }

    const resultBundlePath =
      createBundle === undefined
        ? undefined
        : join(bundleDir, `${bundleFileName(opts.runId)}-${bundleFileName(opts.taskKey)}-result.bundle`);
    return { repoPath: cacheRepo, resultBundlePath };
  };

  const node: LocalNode = {
    id,
    worktreeRoot: options.worktreeRoot,

    info,

    activeSessions: () => tasks.size,

    async startTask(opts) {
      if (tasks.size >= options.maxSessions) {
        throw new StarlingError(
          'INVALID_ARGUMENT',
          `Node ${id} is at capacity (${options.maxSessions} sessions)`,
          {
            details: { nodeId: id, maxSessions: options.maxSessions },
          },
        );
      }
      const key = taskId(opts.runId, opts.taskKey);
      if (tasks.has(key)) {
        throw new StarlingError('INVALID_ARGUMENT', `Node ${id} is already running ${opts.taskKey}`, {
          details: { nodeId: id },
        });
      }

      const prepared = await prepareRepo(opts);
      const worktree = await options.workspace.create(prepared.repoPath, opts.branch, opts.fromRef);

      // Reserve the slot before awaiting the runner so two concurrent startTask calls cannot oversubscribe.
      const reserved: LocalTask = {
        handle: {
          nodeId: id,
          runId: opts.runId,
          taskKey: opts.taskKey,
          branch: opts.branch,
          sessionId: '',
        },
        opts,
        repoPath: prepared.repoPath,
        worktreePath: worktree.path,
        fromBundle: opts.repo.kind === 'bundle',
        resultBundlePath: prepared.resultBundlePath,
      };
      tasks.set(key, reserved);

      try {
        const { sessionId } = await options.runner.start({
          runId: opts.runId,
          taskKey: opts.taskKey,
          dir: worktree.path,
          prompt: opts.prompt,
          model: opts.model,
          title: opts.title,
        });
        const handle: TaskHandle = { ...reserved.handle, sessionId };
        reserved.handle = handle;
        sessionToTask.set(sessionId, key);
        return handle;
      } catch (err) {
        tasks.delete(key);
        // A half-created worktree would confuse the next attempt; best effort, the original error wins.
        await options.workspace.remove(worktree.path).catch(() => undefined);
        throw err;
      }
    },

    async sendPrompt(handle, prompt) {
      const task = requireTask(handle);
      await options.runner.send(task.handle.sessionId, prompt);
    },

    async abort(handle) {
      const task = tasks.get(taskId(handle.runId, handle.taskKey));
      if (task === undefined) return;
      await options.runner.abort(task.handle.sessionId);
    },

    async collect(handle, _hubRepo, baseRef) {
      const task = requireTask(handle);
      const base = baseRef === '' ? task.opts.fromRef : baseRef;
      const committed = await options.workspace.commitAll(
        task.worktreePath,
        `starling: ${task.opts.taskKey} (${task.opts.runId})`,
      );
      // Nothing to commit means the branch is still at the base; otherwise ask git for the real sha.
      const commit = committed ?? (await (options.headSha ?? gitHead)(task.worktreePath)) ?? base;
      const diff = await options.workspace.diff(task.worktreePath, base);
      const changedFiles = await options.workspace.changedFiles(task.worktreePath, base);

      let bundlePath: string | undefined;
      if (
        task.fromBundle &&
        task.resultBundlePath !== undefined &&
        options.workspace.createBundle !== undefined
      ) {
        bundlePath = await options.workspace.createBundle(task.repoPath, task.opts.branch, {
          base: task.opts.fromRef,
          outPath: task.resultBundlePath,
        });
      }

      return { commit, diff, changedFiles, ...(bundlePath === undefined ? {} : { bundlePath }) };
    },

    async cleanup(handle) {
      const key = taskId(handle.runId, handle.taskKey);
      const task = tasks.get(key);
      if (task === undefined) return;
      tasks.delete(key);
      if (task.handle.sessionId !== '') sessionToTask.delete(task.handle.sessionId);
      await options.workspace.remove(task.worktreePath);
    },

    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async close() {
      unsubscribeRunner();
      const live = [...tasks.values()];
      tasks.clear();
      sessionToTask.clear();
      await Promise.all(
        live.map((task) =>
          task.handle.sessionId === ''
            ? Promise.resolve()
            : options.runner.abort(task.handle.sessionId).catch(() => undefined),
        ),
      );
    },
  };

  return node;
}
