import type {
  AgentEvent,
  AuditVerdict,
  MergeResult,
  NodeInfo,
  Plan,
  PlanIssue,
  Run,
  StarlingEvent,
  TaskStatus,
} from '@starling/core';
import { cloneRun } from './run-util';

/**
 * The small amount of state the live view needs, reduced from `StarlingEvent`s.
 *
 * Shared by `starling run` (a real subscription) and `starling replay` (the same reducer over a
 * recorded JSONL file), which is why it cannot depend on the engine or the store.
 */
export interface LiveState {
  run?: Run;
  plan?: Plan;
  issues: PlanIssue[];
  nodes: NodeInfo[];
  lastActions: Record<string, string>;
  verdicts: AuditVerdict[];
  merges: MergeResult[];
  logs: string[];
  /** Replay uses the event timestamp here, so elapsed time follows the recording, not wall clock. */
  now: number;
  finishedSummary?: string;
  eventCount: number;
}

export function emptyLiveState(): LiveState {
  return {
    issues: [],
    nodes: [],
    lastActions: {},
    verdicts: [],
    merges: [],
    logs: [],
    now: 0,
    eventCount: 0,
  };
}

/** Apply an event to a state snapshot in place. Pure in the sense that it only touches the passed state. */
export function applyEvent(state: LiveState, event: StarlingEvent): LiveState {
  state.eventCount += 1;
  state.now = Math.max(state.now, event.ts);

  switch (event.type) {
    case 'run.created': {
      state.run = cloneRun(event.payload.run);
      break;
    }
    case 'repomap.ready': {
      pushLog(state, `mapped ${event.payload.files} files · ~${event.payload.tokenEstimate} tokens`);
      break;
    }
    case 'plan.created': {
      state.plan = event.payload.plan;
      state.issues = event.payload.issues;
      if (state.run !== undefined) {
        state.run.plan = event.payload.plan;
        state.run.status = 'planned';
      }
      pushLog(state, `plan ready: ${event.payload.plan.tasks.length} tasks`);
      break;
    }
    case 'task.status': {
      const { taskKey, to, run } = event.payload;
      if (state.run === undefined) break;
      state.run.tasks[taskKey] = run;
      if (to === 'running' || to === 'auditing' || to === 'fixing' || to === 'merging') {
        state.run.status = 'running';
      }
      state.lastActions[taskKey] = `${arrow(to)} ${to}`;
      break;
    }
    case 'agent.event': {
      state.lastActions[event.payload.taskKey] = describeAgentEvent(event.payload);
      break;
    }
    case 'audit.verdict': {
      state.verdicts.push(event.payload);
      state.lastActions[event.payload.taskKey] = event.payload.pass
        ? `audit ✔ passed (attempt ${event.payload.attempt})`
        : `audit ✘ ${event.payload.summary}`;
      break;
    }
    case 'merge.result': {
      state.merges.push(event.payload);
      state.lastActions[event.payload.taskKey] =
        event.payload.status === 'merged'
          ? `merged ${event.payload.commit?.slice(0, 7) ?? ''}`.trim()
          : `merge ${event.payload.status}`;
      break;
    }
    case 'metrics': {
      if (state.run !== undefined) state.run.metrics = event.payload;
      break;
    }
    case 'log': {
      pushLog(state, event.payload.msg);
      break;
    }
    case 'node.joined':
    case 'node.stats': {
      const index = state.nodes.findIndex((node) => node.id === event.payload.node.id);
      if (index === -1) state.nodes.push(event.payload.node);
      else state.nodes[index] = event.payload.node;
      if (event.type === 'node.joined') pushLog(state, `${event.payload.node.name} joined the flock`);
      break;
    }
    case 'node.left': {
      const index = state.nodes.findIndex((node) => node.id === event.payload.nodeId);
      if (index !== -1) {
        state.nodes[index] = { ...(state.nodes[index] as NodeInfo), status: 'offline', activeSessions: 0 };
      }
      pushLog(state, `${event.payload.nodeId} left: ${event.payload.reason}`);
      break;
    }
    case 'task.migrated': {
      state.lastActions[event.payload.taskKey] =
        `migrated ${event.payload.fromNode} → ${event.payload.toNode}`;
      break;
    }
    case 'run.finished': {
      state.run = cloneRun(event.payload.run);
      state.finishedSummary = event.payload.summary;
      break;
    }
  }

  return state;
}

/** Reduce a recorded stream to the final state (used by `starling status --file`). */
export function stateFromEvents(events: StarlingEvent[]): LiveState {
  const state = emptyLiveState();
  for (const event of events) applyEvent(state, event);
  return state;
}

function pushLog(state: LiveState, line: string): void {
  state.logs.push(line);
  if (state.logs.length > 5) state.logs.shift();
}

function arrow(to: TaskStatus): string {
  return to === 'failed' || to === 'conflict' ? '✘' : '→';
}

/** One short human phrase per agent event — the "last action" column. */
export function describeAgentEvent(event: AgentEvent): string {
  const data = event.data;
  switch (event.kind) {
    case 'session.started': {
      const model = data.model;
      if (isModelRef(model)) return `session started · ${model.model}`;
      return 'session started';
    }
    case 'text':
      return `says ${quote(stringField(data, 'text'))}`;
    case 'tool.call': {
      const tool = stringField(data, 'tool') ?? 'tool';
      const path = stringField(data, 'path') ?? stringField(data, 'file');
      return path === undefined ? `tool ${tool}` : `${tool} ${path}`;
    }
    case 'tool.result':
      return data.ok === false ? 'tool failed' : 'tool ok';
    case 'file.edited':
      return `edited ${stringField(data, 'path') ?? 'a file'}`;
    case 'usage': {
      const input = numberField(data, 'input');
      const output = numberField(data, 'output');
      return `usage ${input ?? 0}+${output ?? 0} tok`;
    }
    case 'session.idle':
      return 'session idle';
    case 'session.error':
      return `error: ${stringField(data, 'reason') ?? 'session failed'}`;
  }
}

function isModelRef(value: unknown): value is { provider: string; model: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { provider?: unknown }).provider === 'string' &&
    typeof (value as { model?: unknown }).model === 'string'
  );
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' ? value : undefined;
}

function numberField(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key];
  return typeof value === 'number' ? value : undefined;
}

function quote(text: string | undefined): string {
  if (text === undefined) return '…';
  return `“${text.replace(/\s+/g, ' ')}”`;
}
