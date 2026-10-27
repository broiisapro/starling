import { type Clock, type MergeResult, newId, type TaskRun } from '@starling/core';
import type { MergeOptions, MergeQueue, MergeQueueEntry } from './types.ts';

export type MergeFn = (
  repo: string,
  integrationBranch: string,
  task: TaskRun,
  opts: MergeOptions,
) => Promise<MergeResult>;

export interface MergeQueueDeps {
  merge: MergeFn;
  clock: Clock;
}

/**
 * Build the serial queue.
 *
 * Tasks are chained through a per-`repo + integrationBranch` tail promise. Two runs of different
 * repos (or two integration branches of the same repo) therefore never wait on each other, while
 * tasks that touch the same branch merge strictly one at a time in enqueue order. A rejected merge
 * is swallowed on the tail so the next task still starts; the rejection is still delivered to the
 * caller of `enqueue`.
 */
export function createMergeQueue({ merge, clock }: MergeQueueDeps): MergeQueue {
  const tails = new Map<string, Promise<void>>();
  const entries: MergeQueueEntry[] = [];
  const history: MergeResult[] = [];
  const listeners = new Set<(result: MergeResult) => void>();

  const notify = (result: MergeResult): void => {
    for (const listener of [...listeners]) {
      try {
        listener(result);
      } catch (err) {
        // The merge already landed; an observer bug must not turn a green branch red. Surface it
        // asynchronously instead of swallowing it (AGENTS.md: never swallow errors silently).
        queueMicrotask(() => {
          throw err;
        });
      }
    }
  };

  const enqueue: MergeQueue['enqueue'] = (repo, integrationBranch, task, opts = {}) => {
    const entry: MergeQueueEntry = {
      id: newId(),
      repo,
      integrationBranch,
      taskKey: task.taskKey,
      branch: task.branch,
      enqueuedAt: clock.now(),
      state: 'queued',
    };
    entries.push(entry);

    const key = `${repo}\u0000${integrationBranch}`;
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(async () => {
      entry.state = 'running';
      try {
        const result = await merge(repo, integrationBranch, task, opts);
        history.push(result);
        notify(result);
        return result;
      } finally {
        const index = entries.indexOf(entry);
        if (index !== -1) entries.splice(index, 1);
      }
    });

    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });

    return run;
  };

  return {
    enqueue,
    pending: () => entries.map((entry) => ({ ...entry })),
    results: () => [...history],
    onResult: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
