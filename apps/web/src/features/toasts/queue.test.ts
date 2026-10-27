import { describe, expect, test } from 'bun:test';
import type { ToastSpec } from './derive';
import {
  AUTO_DISMISS_MS,
  COLLAPSE_WINDOW_MS,
  createToastQueue,
  dismiss,
  emptyStack,
  enqueue,
  isSticky,
  MAX_VISIBLE,
  pauseAll,
  resumeAll,
  type ToastTimers,
  tick,
} from './queue';
import { TS } from './test-events';

function spec(overrides: Partial<ToastSpec> = {}): ToastSpec {
  return {
    id: 'merge.result:run-1:a:merged',
    kind: 'merged',
    tone: 'success',
    title: 'a landed',
    taskKey: 'a',
    ts: TS,
    ...overrides,
  };
}

function landed(taskKey: string, overrides: Partial<ToastSpec> = {}): ToastSpec {
  return spec({
    id: `merge.result:run-1:${taskKey}:merged`,
    title: `${taskKey} landed`,
    taskKey,
    ...overrides,
  });
}

describe('enqueue', () => {
  test('newest is on top', () => {
    const stack = enqueue(
      enqueue(emptyStack(), spec({ id: 'one', title: 'one', kind: 'node-joined', tone: 'info' }), TS),
      spec({ id: 'two', title: 'two', kind: 'node-left', tone: 'warn' }),
      TS + 1,
    );
    expect(stack.entries.map((entry) => entry.title)).toEqual(['two', 'one']);
  });

  test(`at most ${MAX_VISIBLE} stay visible`, () => {
    let stack = emptyStack();
    for (let index = 0; index < 7; index += 1) {
      stack = enqueue(stack, spec({ id: `t${index}`, title: `t${index}`, kind: 'error' }), TS + index);
    }
    expect(stack.entries).toHaveLength(MAX_VISIBLE);
    expect(stack.entries[0]?.title).toBe('t6');
    expect(stack.entries.at(-1)?.title).toBe('t3');
  });

  test('the same id is idempotent (metrics re-emit the budget toast)', () => {
    const first = enqueue(emptyStack(), spec({ id: 'budget', kind: 'budget' }), TS);
    const second = enqueue(first, spec({ id: 'budget', kind: 'budget' }), TS + 1_000);
    expect(second).toBe(first);
  });

  test('a closed id stays closed', () => {
    const closed = dismiss(enqueue(emptyStack(), spec({ id: 'closed' }), TS), 'closed');
    const again = enqueue(closed, spec({ id: 'closed' }), TS + 1);
    expect(again.entries).toEqual([]);
  });

  test('landings inside the window collapse into one counter and move to the top', () => {
    let stack = enqueue(emptyStack(), landed('a'), TS);
    stack = enqueue(
      stack,
      spec({ id: 'audit', kind: 'audit-failed', title: 'audit', tone: 'danger', taskKey: 'x' }),
      TS + 100,
    );
    stack = enqueue(stack, landed('b'), TS + 500);
    stack = enqueue(stack, landed('c'), TS + 900);

    const merged = stack.entries.filter((entry) => entry.spec.kind === 'merged');
    expect(merged).toHaveLength(1);
    expect(merged[0]?.count).toBe(3);
    expect(merged[0]?.title).toBe('3 tasks landed');
    expect(merged[0]?.spec.taskKey).toBeUndefined();
    expect(stack.entries[0]?.title).toBe('3 tasks landed');
    expect(stack.entries).toHaveLength(2);
  });

  test('landings outside the window stay separate', () => {
    let stack = enqueue(emptyStack(), landed('a'), TS);
    stack = enqueue(stack, landed('b'), TS + COLLAPSE_WINDOW_MS + 1);
    expect(stack.entries).toHaveLength(2);
    expect(stack.entries.map((entry) => entry.title)).toEqual(['b landed', 'a landed']);
  });

  test('a single landing keeps its task title', () => {
    const stack = enqueue(emptyStack(), landed('a'), TS);
    expect(stack.entries[0]?.title).toBe('a landed');
    expect(stack.entries[0]?.count).toBe(1);
  });
});

describe('dismiss and tick', () => {
  test('dismiss removes the entry and remembers it', () => {
    const stack = dismiss(enqueue(emptyStack(), spec({ id: 'x' }), TS), 'x');
    expect(stack.entries).toEqual([]);
    expect(stack.dismissed).toContain('x');
  });

  test('auto-dismiss happens at six seconds, not before', () => {
    const stack = enqueue(emptyStack(), spec({ id: 'x' }), TS);
    expect(tick(stack, TS + AUTO_DISMISS_MS - 1).entries).toHaveLength(1);
    expect(tick(stack, TS + AUTO_DISMISS_MS).entries).toEqual([]);
  });

  test('errors stay until dismissed', () => {
    expect(isSticky('error')).toBe(true);
    const stack = enqueue(emptyStack(), spec({ id: 'err', kind: 'error', tone: 'danger' }), TS);
    expect(stack.entries[0]?.expiresAt).toBeUndefined();
    expect(tick(stack, TS + AUTO_DISMISS_MS * 10).entries).toHaveLength(1);
  });

  test('budget stays until dismissed', () => {
    expect(isSticky('budget')).toBe(true);
    const stack = enqueue(emptyStack(), spec({ id: 'budget', kind: 'budget', tone: 'warn' }), TS);
    expect(tick(stack, TS + AUTO_DISMISS_MS * 10).entries).toHaveLength(1);
  });
});

describe('pause and resume', () => {
  test('hover freezes the countdown and resume continues from the remaining time', () => {
    const stack = enqueue(emptyStack(), spec({ id: 'x' }), TS);
    const paused = pauseAll(tick(stack, TS + 2_000), TS + 4_000);
    expect(paused.entries[0]?.paused).toBe(true);
    expect(paused.entries[0]?.remainingMs).toBe(2_000);
    expect(tick(paused, TS + 100_000).entries).toHaveLength(1);

    const resumed = resumeAll(paused, TS + 100_000);
    expect(tick(resumed, TS + 101_999).entries).toHaveLength(1);
    expect(tick(resumed, TS + 102_000).entries).toEqual([]);
  });

  test('pausing an idle stack is a no-op object-wise', () => {
    const stack = enqueue(emptyStack(), spec({ id: 'err', kind: 'error', tone: 'danger' }), TS);
    expect(pauseAll(stack, TS + 1)).toBe(stack);
    expect(resumeAll(stack, TS + 1)).toBe(stack);
  });
});

describe('createToastQueue', () => {
  function harness() {
    let clock = TS;
    const scheduled: { at: number; run: () => void }[] = [];
    const timers: ToastTimers = {
      setTimeout(handler, ms) {
        const entry = { at: clock + ms, run: handler };
        scheduled.push(entry);
        return entry;
      },
      clearTimeout(handle) {
        const index = scheduled.indexOf(handle as { at: number; run: () => void });
        if (index >= 0) scheduled.splice(index, 1);
      },
    };
    const queue = createToastQueue({ timers, now: () => clock });
    const advance = (ms: number): void => {
      clock += ms;
      for (const entry of [...scheduled]) {
        if (entry.at <= clock) {
          const index = scheduled.indexOf(entry);
          if (index >= 0) scheduled.splice(index, 1);
          entry.run();
        }
      }
    };
    return { queue, advance, scheduled };
  }

  test('the timer removes an auto-dismissed toast', () => {
    const { queue, advance } = harness();
    queue.push(spec({ id: 'x' }));
    expect(queue.getSnapshot().entries).toHaveLength(1);
    advance(AUTO_DISMISS_MS);
    expect(queue.getSnapshot().entries).toEqual([]);
  });

  test('pauseAll clears the timer and resumeAll reschedules the remainder', () => {
    const { queue, advance, scheduled } = harness();
    queue.push(spec({ id: 'x' }));
    advance(2_000);
    queue.pauseAll();
    expect(scheduled).toHaveLength(0);
    advance(100_000);
    expect(queue.getSnapshot().entries).toHaveLength(1);
    queue.resumeAll();
    advance(3_999);
    expect(queue.getSnapshot().entries).toHaveLength(1);
    advance(1);
    expect(queue.getSnapshot().entries).toEqual([]);
  });

  test('subscribers hear every change and stop after dispose', () => {
    const { queue } = harness();
    let calls = 0;
    const stop = queue.subscribe(() => {
      calls += 1;
    });
    queue.push(spec({ id: 'x' }));
    queue.dismiss('x');
    expect(calls).toBe(2);
    stop();
    queue.push(spec({ id: 'y' }));
    expect(calls).toBe(2);
    queue.dispose();
  });
});
