/**
 * A scripted `ExecutionNode` for resolver tests: a real worktree, a fake agent.
 *
 * Instead of an LLM it runs a `script` — an ordinary function that writes the "resolution" into the
 * worktree — then emits `session.idle`. Everything around the agent is real: a real git repo, a real
 * worktree from `@starling/workspace`, a real commit on collect and real events for the idle wait.
 */
import type {
  AgentEvent,
  Clock,
  ExecutionNode,
  NodeInfo,
  StartTaskOptions,
  TaskHandle,
  TaskResult,
  Workspace,
} from '@starling/core';
import { StarlingError, systemClock } from '@starling/core';
import { makeNodeInfo } from '@starling/core/testing';

export interface ScriptedAgentContext {
  /** The worktree the agent "works" in. */
  dir: string;
  opts: StartTaskOptions;
  prompt: string;
  /** 1 for the start prompt, 2+ for each `sendPrompt` in the same session. */
  pass: number;
}

/** Do whatever the fake agent does: read files, write files, commit (or deliberately not). */
export type ScriptedAgent = (ctx: ScriptedAgentContext) => void | Promise<void>;

export interface ScriptedNodeOptions {
  workspace: Workspace;
  script: ScriptedAgent;
  id?: string;
  clock?: Clock;
  /** When false, the node never emits `session.idle` (models a hung agent). Default true. */
  idle?: boolean;
}

interface Session {
  handle: TaskHandle;
  worktreePath: string;
  opts: StartTaskOptions;
  pass: number;
}

export class ScriptedNode implements ExecutionNode {
  readonly id: string;
  readonly startedTasks: StartTaskOptions[] = [];
  readonly prompts: Array<{ sessionId: string; prompt: string }> = [];
  readonly collected: TaskHandle[] = [];
  readonly cleaned: TaskHandle[] = [];

  readonly #workspace: Workspace;
  readonly #script: ScriptedAgent;
  readonly #clock: Clock;
  readonly #idle: boolean;
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  readonly #sessions = new Map<string, Session>();
  #counter = 0;

  constructor(options: ScriptedNodeOptions) {
    this.#workspace = options.workspace;
    this.#script = options.script;
    this.#clock = options.clock ?? systemClock;
    this.#idle = options.idle ?? true;
    this.id = options.id ?? 'hub';
  }

  async info(): Promise<NodeInfo> {
    return makeNodeInfo({
      id: this.id,
      activeSessions: this.#sessions.size,
      status: this.#sessions.size > 0 ? 'busy' : 'online',
      lastSeen: this.#clock.now(),
    });
  }

  async startTask(opts: StartTaskOptions): Promise<TaskHandle> {
    if (opts.repo.kind !== 'local') {
      throw new StarlingError('INVALID_ARGUMENT', 'ScriptedNode only runs local-repo tasks');
    }
    this.#counter += 1;
    const worktree = await this.#workspace.create(opts.repo.path, opts.branch, opts.fromRef);
    const handle: TaskHandle = {
      nodeId: this.id,
      runId: opts.runId,
      taskKey: opts.taskKey,
      branch: opts.branch,
      sessionId: `ses_scripted_${this.#counter}`,
    };
    this.startedTasks.push(opts);
    this.#sessions.set(handle.sessionId, { handle, worktreePath: worktree.path, opts, pass: 1 });
    await this.#run(handle, opts.prompt, 1);
    return handle;
  }

  async sendPrompt(handle: TaskHandle, prompt: string): Promise<void> {
    const session = this.#require(handle);
    session.pass += 1;
    this.prompts.push({ sessionId: handle.sessionId, prompt });
    await this.#run(handle, prompt, session.pass);
  }

  async abort(handle: TaskHandle): Promise<void> {
    this.#sessions.delete(handle.sessionId);
    this.#emit(handle, 'session.error', { reason: 'aborted' });
  }

  async collect(handle: TaskHandle, _hubRepo: string, baseRef: string): Promise<TaskResult> {
    const session = this.#require(handle);
    this.collected.push(handle);
    const commit = await this.#workspace.commitAll(session.worktreePath, `scripted: ${handle.taskKey}`);
    const diff = await this.#workspace.diff(session.worktreePath, baseRef);
    const changedFiles = await this.#workspace.changedFiles(session.worktreePath, baseRef);
    return { commit: commit ?? baseRef, diff, changedFiles };
  }

  async cleanup(handle: TaskHandle): Promise<void> {
    const session = this.#sessions.get(handle.sessionId);
    if (session === undefined) return;
    this.#sessions.delete(handle.sessionId);
    this.cleaned.push(handle);
    await this.#workspace.remove(session.worktreePath);
  }

  onEvent(fn: (event: AgentEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Sessions the fake agent worked in; useful for assertions about retries. */
  sessionIds(): string[] {
    return [...this.#sessions.keys()];
  }

  async #run(handle: TaskHandle, prompt: string, pass: number): Promise<void> {
    const session = this.#require(handle);
    this.#emit(handle, 'session.started', { branch: handle.branch });
    await this.#script({ dir: session.worktreePath, opts: session.opts, prompt, pass });
    this.#emit(handle, 'text', { text: `scripted pass ${pass}` });
    if (this.#idle) {
      // Idle arrives on a later tick, exactly like a real node: the caller must be listening.
      setTimeout(() => this.#emit(handle, 'session.idle', {}), 0);
    }
  }

  #require(handle: TaskHandle): Session {
    const session = this.#sessions.get(handle.sessionId);
    if (session === undefined) {
      throw new StarlingError('RUNNER_ERROR', `ScriptedNode has no session ${handle.sessionId}`, {
        details: { taskKey: handle.taskKey },
      });
    }
    return session;
  }

  #emit(handle: TaskHandle, kind: AgentEvent['kind'], data: Record<string, unknown>): void {
    const event: AgentEvent = {
      runId: handle.runId,
      taskKey: handle.taskKey,
      sessionId: handle.sessionId,
      ts: this.#clock.now(),
      kind,
      data,
    };
    for (const listener of [...this.#listeners]) listener(event);
  }
}
