/**
 * A no-LLM `AgentRunner` for Flock loopback runs.
 *
 * It is the real `ReplayRunner` from `@starling/runner` with two additions the loopback needs:
 *
 * 1. a per-start `edit` hook, so the "agent" leaves a real change in the worktree (otherwise every
 *    diff is empty and the bundle round trip proves nothing);
 * 2. session fan-out, because `ReplayRunner` supports one session per instance while a perch serves
 *    a sequence of tasks.
 *
 * Timing comes from the recorded events, so the loopback is deterministic and never touches a model.
 */
import type { AgentEvent, AgentRunner, Clock, ModelRef } from '../../packages/core/src/index.ts';
import { createReplayRunner, type ReplayRunner } from '../../packages/runner/src/index.ts';

export interface ReplayAgentStart {
  runId: string;
  taskKey: string;
  dir: string;
  prompt: string;
  model: ModelRef;
  title: string;
}

export interface ReplayAgentOptions {
  /**
   * Simulated agent work. Runs before the replay starts, so a collector that races `session.idle`
   * can never see an empty worktree.
   */
  edit?: (ctx: ReplayAgentStart) => void | Promise<void>;
  /** Recorded events to replay. Defaults to a seven-event coding turn ending in `session.idle`. */
  events?: AgentEvent[];
  /** Playback speed. Default 1 (real time relative to the recording). */
  speed?: number;
  clock?: Clock;
  newSessionId?: () => string;
}

/**
 * A coding turn that takes 400 ms and ends with `session.idle` — long enough to kill a perch
 * mid-task, short enough for a test that runs four of them.
 */
export function defaultReplayEvents(): AgentEvent[] {
  const at = (ts: number, kind: AgentEvent['kind'], data: Record<string, unknown>): AgentEvent => ({
    runId: 'replay',
    taskKey: 'replay',
    sessionId: 'replay',
    ts,
    kind,
    data,
  });
  return [
    at(0, 'session.started', { replay: true }),
    at(30, 'text', { text: 'Looking at the repo…' }),
    at(60, 'tool.call', { tool: 'read', input: { path: 'src/app.ts' } }),
    at(90, 'tool.result', { tool: 'read', ok: true }),
    at(120, 'file.edited', { path: 'src/agent.ts' }),
    at(150, 'usage', { input: 640, output: 120, cached: 0 }),
    at(400, 'session.idle', { replay: true }),
  ];
}

/** `AgentRunner` with the extras a loopback wants to introspect. */
export interface ReplayAgent extends AgentRunner {
  /** How many sessions have been started (one per task). */
  readonly started: number;
}

export function createReplayAgent(options: ReplayAgentOptions = {}): ReplayAgent {
  const listeners = new Set<(event: AgentEvent) => void>();
  const sessions = new Map<string, ReplayRunner>();
  let started = 0;

  return {
    get started() {
      return started;
    },

    async start(opts) {
      if (options.edit !== undefined) await options.edit(opts);
      const runner = createReplayRunner({
        events: options.events ?? defaultReplayEvents(),
        speed: options.speed,
        ...(options.clock === undefined ? {} : { clock: options.clock }),
        ...(options.newSessionId === undefined ? {} : { newSessionId: options.newSessionId }),
      });
      runner.onEvent((event) => {
        for (const listener of [...listeners]) listener(event);
      });
      const { sessionId } = await runner.start(opts);
      sessions.set(sessionId, runner);
      started += 1;
      return { sessionId };
    },

    async send(sessionId, prompt) {
      const runner = sessions.get(sessionId);
      if (runner === undefined) throw new Error(`replay agent has no session ${sessionId}`);
      await runner.send(sessionId, prompt);
    },

    async abort(sessionId) {
      await sessions.get(sessionId)?.abort(sessionId);
    },

    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async close() {
      for (const runner of sessions.values()) await runner.close();
      sessions.clear();
      listeners.clear();
    },
  };
}
