/**
 * Test doubles shared by the robustness specs. Not exported from the package index.
 */
import type { TaskHandle } from '@starling/core';
import { MockNode, type MockNodeOptions } from '@starling/core/testing';

/**
 * A `MockNode` whose `abort` behaves like the real runner's: the current turn is interrupted but the
 * session survives, so the engine's "abort then resend" path can reuse it.
 */
export class PatientNode extends MockNode {
  readonly abortCalls: TaskHandle[] = [];
  cleanupCalls = 0;

  override async abort(handle: TaskHandle): Promise<void> {
    this.abortCalls.push(handle);
  }

  override async cleanup(handle: TaskHandle): Promise<void> {
    this.cleanupCalls += 1;
    await super.cleanup(handle);
  }
}

/** A node that reports its worktree on the handle (the additive field the engine feature-detects). */
export class WorktreeNode extends MockNode {
  readonly #worktreePath: string;

  constructor(options: MockNodeOptions & { worktreePath: string }) {
    super(options);
    this.#worktreePath = options.worktreePath;
  }

  override async startTask(opts: Parameters<MockNode['startTask']>[0]): Promise<TaskHandle> {
    const handle = await super.startTask(opts);
    return { ...handle, worktreePath: this.#worktreePath } as TaskHandle;
  }
}
