import type { ToastKind, ToastSpec } from './derive';

/**
 * The visible toast stack: pure reducer plus a tiny timer-driven controller.
 *
 * Pure functions take `now` explicitly so tests never touch the wall clock. The controller exists
 * because scheduling is the one impure part, and takes injectable timers so a test can drive it
 * without a build machine under 100× load making a 6 s test flaky.
 */
export interface ToastEntry {
  spec: ToastSpec;
  /** How many arrivals this entry represents. Only `merged` collapses, so it is 1 for the rest. */
  count: number;
  /** Rendered title, which changes when a merged group collapses ("3 tasks landed"). */
  title: string;
  /** When this entry (or its group) first appeared. */
  since: number;
  /** When the last repeat arrived; the collapse window is measured from here. */
  lastAt: number;
  /** Epoch ms at which the entry disappears. Sticky entries have none. */
  expiresAt?: number;
  /** Lifetime left while paused, so hovering does not reset the clock. */
  remainingMs: number;
  paused: boolean;
}

export interface ToastStack {
  /** Newest first, at most `MAX_VISIBLE`. */
  entries: ToastEntry[];
  /** Ids the user closed explicitly; they must not come back when an event is re-derived. */
  dismissed: string[];
}

export const MAX_VISIBLE = 4;
export const AUTO_DISMISS_MS = 6_000;
/** Landings this close together become one "N tasks landed" toast. */
export const COLLAPSE_WINDOW_MS = 4_000;
const DISMISSED_CAP = 200;

/** Errors and budget warnings stay until dismissed: they are the two the user must acknowledge. */
export function isSticky(kind: ToastKind): boolean {
  return kind === 'error' || kind === 'budget';
}

export function emptyStack(): ToastStack {
  return { entries: [], dismissed: [] };
}

function withDismissed(dismissed: readonly string[], id: string): string[] {
  const next: string[] = dismissed.includes(id) ? [...dismissed] : [...dismissed, id];
  return next.length > DISMISSED_CAP ? next.slice(next.length - DISMISSED_CAP) : next;
}

function collapsedTitle(count: number): string {
  return `${count} tasks landed`;
}

function trim(entries: ToastEntry[]): ToastEntry[] {
  return entries.length > MAX_VISIBLE ? entries.slice(0, MAX_VISIBLE) : entries;
}

/**
 * Put a toast on the stack.
 *
 * - an id already on screen is a no-op (metrics re-emit the budget toast every sample);
 * - an explicitly dismissed id is ignored;
 * - a landing within `COLLAPSE_WINDOW_MS` of the previous landing joins it and moves it to the top,
 *   so a flurry of merges reads as one "3 tasks landed" rather than four cards.
 */
export function enqueue(stack: ToastStack, spec: ToastSpec, now: number): ToastStack {
  if (stack.dismissed.includes(spec.id)) return stack;
  if (stack.entries.some((entry) => entry.spec.id === spec.id)) return stack;

  if (spec.kind === 'merged') {
    const group = stack.entries.find((entry) => entry.spec.kind === 'merged');
    if (group !== undefined && now - group.lastAt <= COLLAPSE_WINDOW_MS) {
      const count = group.count + 1;
      const merged: ToastEntry = {
        spec: {
          ...group.spec,
          id: group.spec.id,
          title: collapsedTitle(count),
          ts: spec.ts,
          taskKey: undefined,
          body: undefined,
        },
        count,
        title: collapsedTitle(count),
        since: group.since,
        lastAt: now,
        expiresAt: now + AUTO_DISMISS_MS,
        remainingMs: AUTO_DISMISS_MS,
        paused: false,
      };
      // The group now stands for the newest landing, so it moves to the top.
      return {
        ...stack,
        entries: trim([merged, ...stack.entries.filter((entry) => entry.spec.id !== group.spec.id)]),
      };
    }
  }

  const entry: ToastEntry = {
    spec,
    count: 1,
    title: spec.title,
    since: now,
    lastAt: now,
    remainingMs: AUTO_DISMISS_MS,
    paused: false,
    ...(isSticky(spec.kind) ? {} : { expiresAt: now + AUTO_DISMISS_MS }),
  };
  return { ...stack, entries: trim([entry, ...stack.entries]) };
}

/** Close one toast. The id is remembered so a later re-derivation cannot resurrect it. */
export function dismiss(stack: ToastStack, id: string): ToastStack {
  const entries = stack.entries.filter((entry) => entry.spec.id !== id);
  const dismissed = withDismissed(stack.dismissed, id);
  if (entries.length === stack.entries.length && dismissed === stack.dismissed) return stack;
  return { entries, dismissed };
}

/** Remove entries whose 6 s are up. Paused entries keep their remaining lifetime. */
export function tick(stack: ToastStack, now: number): ToastStack {
  const entries = stack.entries.filter(
    (entry) => entry.paused || entry.expiresAt === undefined || now < entry.expiresAt,
  );
  return entries.length === stack.entries.length ? stack : { ...stack, entries };
}

/** Freeze every countdown; `remainingMs` survives so a hover does not grant a fresh 6 s. */
export function pauseAll(stack: ToastStack, now: number): ToastStack {
  let changed = false;
  const entries = stack.entries.map((entry) => {
    if (entry.paused || entry.expiresAt === undefined) return entry;
    changed = true;
    return {
      ...entry,
      paused: true,
      remainingMs: Math.max(0, entry.expiresAt - now),
      expiresAt: undefined,
    };
  });
  return changed ? { ...stack, entries } : stack;
}

/** Restart every countdown from the lifetime it had left. */
export function resumeAll(stack: ToastStack, now: number): ToastStack {
  let changed = false;
  const entries = stack.entries.map((entry) => {
    if (!entry.paused) return entry;
    changed = true;
    const remaining = Math.max(0, entry.remainingMs);
    return { ...entry, paused: false, expiresAt: now + remaining, remainingMs: remaining };
  });
  return changed ? { ...stack, entries } : stack;
}

export interface ToastTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserTimers: ToastTimers = {
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

export interface ToastQueueOptions {
  timers?: ToastTimers;
  now?: () => number;
}

export interface ToastQueue {
  getSnapshot(): ToastStack;
  subscribe(listener: () => void): () => void;
  push(spec: ToastSpec): void;
  dismiss(id: string): void;
  pauseAll(): void;
  resumeAll(): void;
  clear(): void;
  dispose(): void;
}

/**
 * Timer-driven stack used by `ToastHost`. One timeout is kept for the earliest expiry; when it fires
 * the stack ticks and the next timeout is scheduled. Pausing clears the timeout, resuming recomputes
 * it from the remaining lifetimes.
 */
export function createToastQueue(options: ToastQueueOptions = {}): ToastQueue {
  const timers = options.timers ?? browserTimers;
  const now = options.now ?? Date.now;
  let stack = emptyStack();
  let timer: unknown;
  let disposed = false;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  const clearTimer = (): void => {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
  };

  const schedule = (): void => {
    clearTimer();
    if (disposed) return;
    let next: number | undefined;
    for (const entry of stack.entries) {
      if (entry.paused || entry.expiresAt === undefined) continue;
      next = next === undefined ? entry.expiresAt : Math.min(next, entry.expiresAt);
    }
    if (next === undefined) return;
    timer = timers.setTimeout(
      () => {
        timer = undefined;
        if (disposed) return;
        stack = tick(stack, now());
        emit();
        schedule();
      },
      Math.max(0, next - now()),
    );
  };

  return {
    getSnapshot: () => stack,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(spec) {
      const next = enqueue(stack, spec, now());
      if (next === stack) return;
      stack = next;
      emit();
      schedule();
    },
    dismiss(id) {
      const next = dismiss(stack, id);
      if (next === stack) return;
      stack = next;
      emit();
      schedule();
    },
    pauseAll() {
      const next = pauseAll(stack, now());
      if (next === stack) return;
      stack = next;
      emit();
      clearTimer();
    },
    resumeAll() {
      const next = resumeAll(stack, now());
      if (next === stack) return;
      stack = next;
      emit();
      schedule();
    },
    clear() {
      clearTimer();
      stack = emptyStack();
      emit();
    },
    dispose() {
      disposed = true;
      clearTimer();
      listeners.clear();
    },
  };
}
