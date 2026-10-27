/**
 * A LIFO disposal stack for the real composition.
 *
 * The real stack owns processes (one `opencode serve`, timers, a SQLite handle, an HTTP server) and
 * a Ctrl-C must not leave any of them behind. Every `composeReal` resource pushes its own teardown
 * here in creation order; `run()` walks the stack backwards, runs every entry even if an earlier one
 * threw, and is idempotent so a signal handler and a normal exit cannot double-close.
 */
export type Disposal = { label: string; fn: () => void | Promise<void> };

export interface DisposalStack {
  /** Register a teardown. Returns the stack so calls can chain. */
  push(label: string, fn: () => void | Promise<void>): DisposalStack;
  /** Run every teardown, newest first. Resolves after all of them have been attempted. */
  run(): Promise<string[]>;
  readonly disposed: boolean;
}

export function createDisposalStack(): DisposalStack {
  const entries: Disposal[] = [];
  let running: Promise<string[]> | undefined;

  return {
    push(label, fn) {
      entries.push({ label, fn });
      return this;
    },
    get disposed() {
      return running !== undefined;
    },
    run() {
      running ??= (async () => {
        const failures: string[] = [];
        // Backwards: the runner must die before the store closes, the timers before the node.
        for (const entry of [...entries].reverse()) {
          try {
            await entry.fn();
          } catch (err) {
            failures.push(`${entry.label}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        return failures;
      })();
      return running;
    },
  };
}
