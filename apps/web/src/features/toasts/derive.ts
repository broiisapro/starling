import type { NodeInfo, Run, StarlingEvent } from '@starling/core/browser';
import type { BadgeTone } from '../../components';
import { formatUsd, percent } from '../../lib/format';

/**
 * Turn a batch of freshly observed events into toasts.
 *
 * Pure and DOM-free on purpose: `ToastHost` feeds it the tail from `cursor.ts` and every rule here
 * is testable by feeding fixture events. Nothing in this module reads the store, timers or the
 * document.
 *
 * The mapping is intentionally narrow. A dashboard that toasts every `task.status` is noise; these
 * are the moments a human would want a tap on the shoulder (the assignment's goal).
 */
export type ToastKind =
  | 'merged'
  | 'audit-failed'
  | 'conflict'
  | 'node-joined'
  | 'node-left'
  | 'migrated'
  | 'budget'
  | 'run-finished'
  | 'error';

export interface ToastSpec {
  /** Stable dedupe key: `type:runId:taskKey:attempt-or-status` (see `toastId`). */
  id: string;
  kind: ToastKind;
  tone: BadgeTone;
  title: string;
  body?: string;
  taskKey?: string;
  ts: number;
}

export interface ToastContext {
  /** `SkyState.nodes` or the sorted array from `sortedNodes`; both are accepted. */
  nodes: Record<string, NodeInfo> | readonly NodeInfo[];
  run?: Run;
  /** Per-run cap in USD. Without it no budget toast is ever derived. */
  budgetUsd?: number;
}

/** Warn once the API spend reaches this share of the budget; the hard stop is 100 %. */
export const BUDGET_WARN_RATIO = 0.8;
/** Long summaries are clipped so a toast never grows taller than the stack. */
export const TOAST_BODY_MAX = 180;

function isNodeArray(nodes: Record<string, NodeInfo> | readonly NodeInfo[]): nodes is readonly NodeInfo[] {
  return Array.isArray(nodes);
}

function nodeIndex(nodes: Record<string, NodeInfo> | readonly NodeInfo[]): Record<string, NodeInfo> {
  if (!isNodeArray(nodes)) return nodes;
  const index: Record<string, NodeInfo> = {};
  for (const node of nodes) index[node.id] = node;
  return index;
}

function clip(value: string, max = TOAST_BODY_MAX): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function nodeName(index: Record<string, NodeInfo>, id: string): string {
  return index[id]?.name ?? id;
}

/**
 * `type:runId:taskKey:attempt-or-status`.
 *
 * `attempt` discriminates audit retries, `status` discriminates merge outcomes, and node events use
 * the node id as their key. Log lines have no natural status, so the envelope `ts` is the
 * discriminator — otherwise two unrelated errors would collapse into one toast.
 */
export function toastId(type: string, runId: string, key: string | undefined, discriminator: string): string {
  return `${type}:${runId}:${key ?? '-'}:${discriminator}`;
}

function mergeToast(event: Extract<StarlingEvent, { type: 'merge.result' }>): ToastSpec | undefined {
  const { taskKey, status, detail, conflictedFiles } = event.payload;
  if (status === 'merged') {
    return {
      id: toastId('merge.result', event.runId, taskKey, status),
      kind: 'merged',
      tone: 'success',
      title: `${taskKey} landed`,
      taskKey,
      ts: event.ts,
    };
  }
  if (status === 'conflict' || status === 'tests-failed') {
    const where = conflictedFiles.length > 0 ? ` (${conflictedFiles.join(', ')})` : '';
    return {
      id: toastId('merge.result', event.runId, taskKey, status),
      kind: 'conflict',
      tone: 'danger',
      title: status === 'conflict' ? `${taskKey} hit a conflict` : `${taskKey} broke the suite`,
      body: clip(`${detail}${where}`),
      taskKey,
      ts: event.ts,
    };
  }
  // `skipped` is a no-op merge (nothing to do); it is not worth a toast.
  return undefined;
}

function auditToast(event: Extract<StarlingEvent, { type: 'audit.verdict' }>): ToastSpec | undefined {
  const verdict = event.payload;
  if (verdict.pass) return undefined;
  const failing = verdict.checks.find((check) => !check.ok);
  const body =
    failing === undefined ? clip(verdict.summary) : clip(`Failed check: ${failing.name} — ${failing.detail}`);
  return {
    id: toastId('audit.verdict', event.runId, verdict.taskKey, String(verdict.attempt)),
    kind: 'audit-failed',
    tone: 'danger',
    title: `${verdict.taskKey} failed its audit`,
    body,
    taskKey: verdict.taskKey,
    ts: event.ts,
  };
}

function runFinishedToast(event: Extract<StarlingEvent, { type: 'run.finished' }>): ToastSpec {
  const run = event.payload.run;
  const failed =
    run.status === 'failed' ||
    run.metrics.tasksFailed > 0 ||
    Object.values(run.tasks).some((task) => task.status === 'failed');
  return {
    id: toastId('run.finished', event.runId, undefined, failed ? 'failed' : 'finished'),
    kind: 'run-finished',
    tone: failed ? 'danger' : 'success',
    title: failed ? 'Run finished with failures' : 'Run finished',
    body: clip(event.payload.summary),
    ts: event.ts,
  };
}

function toastForEvent(event: StarlingEvent, nodes: Record<string, NodeInfo>): ToastSpec | undefined {
  switch (event.type) {
    case 'merge.result':
      return mergeToast(event);

    case 'audit.verdict':
      return auditToast(event);

    case 'node.joined': {
      const node = event.payload.node;
      const displayName = nodes[node.id]?.name ?? (node.name === '' ? node.id : node.name);
      return {
        id: toastId('node.joined', event.runId, node.id, 'joined'),
        kind: 'node-joined',
        tone: 'info',
        title: `${displayName} joined the flock`,
        body: `${node.kind === 'remote' ? 'Perch' : 'Hub'} · ${node.maxSessions} session slots`,
        ts: event.ts,
      };
    }

    case 'node.left': {
      const { nodeId, reason } = event.payload;
      return {
        id: toastId('node.left', event.runId, nodeId, 'left'),
        kind: 'node-left',
        tone: 'warn',
        title: `${nodeName(nodes, nodeId)} left the flock`,
        body: clip(reason),
        ts: event.ts,
      };
    }

    case 'task.migrated': {
      const { taskKey, fromNode, toNode, reason } = event.payload;
      return {
        id: toastId('task.migrated', event.runId, taskKey, toNode),
        kind: 'migrated',
        tone: 'info',
        title: `${taskKey} flew to ${nodeName(nodes, toNode)}`,
        body: clip(reason === '' ? `${nodeName(nodes, fromNode)} went offline` : reason),
        taskKey,
        ts: event.ts,
      };
    }

    case 'log': {
      const { level, msg, taskKey } = event.payload;
      if (level !== 'error') return undefined;
      return {
        id: toastId('log', event.runId, taskKey, `error:${event.ts}`),
        kind: 'error',
        tone: 'danger',
        title: clip(msg),
        taskKey,
        ts: event.ts,
      };
    }

    case 'run.finished':
      return runFinishedToast(event);

    default:
      // `run.status` and any future additive event are deliberately ignored here: only the run's
      // terminal event is worth a toast. No exhaustive `never` check — core grows this union.
      return undefined;
  }
}

/**
 * The highest budget threshold reached by the latest metrics sample in this batch.
 *
 * Emitting only the highest threshold avoids two stacked budget toasts at 100 %. Repeated metrics
 * samples produce the same id, which the queue treats as a no-op, so the warn lands once.
 */
function budgetToast(events: readonly StarlingEvent[], budgetUsd: number | undefined): ToastSpec | undefined {
  if (budgetUsd === undefined || !(budgetUsd > 0)) return undefined;
  let latest: { ts: number; cost: number; runId: string } | undefined;
  for (const event of events) {
    if (event.type === 'metrics') {
      latest = { ts: event.ts, cost: event.payload.apiCostUsd, runId: event.runId };
    }
  }
  if (latest === undefined) return undefined;
  const ratio = latest.cost / budgetUsd;
  if (ratio >= 1) {
    return {
      id: toastId('metrics', latest.runId, undefined, 'budget-100'),
      kind: 'budget',
      tone: 'danger',
      title: 'Budget spent',
      body: `${formatUsd(latest.cost)} of ${formatUsd(budgetUsd)} · ${percent(latest.cost, budgetUsd)}%`,
      ts: latest.ts,
    };
  }
  if (ratio >= BUDGET_WARN_RATIO) {
    return {
      id: toastId('metrics', latest.runId, undefined, 'budget-80'),
      kind: 'budget',
      tone: 'warn',
      title: 'Budget running hot',
      body: `${formatUsd(latest.cost)} of ${formatUsd(budgetUsd)} · ${percent(latest.cost, budgetUsd)}%`,
      ts: latest.ts,
    };
  }
  return undefined;
}

function dedupe(specs: ToastSpec[]): ToastSpec[] {
  const byId = new Map<string, ToastSpec>();
  for (const spec of specs) byId.set(spec.id, spec);
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

/**
 * Derive toasts for a batch of events.
 *
 * Duplicate ids inside one batch keep the newest spec (a slice can contain the same event twice
 * after a re-filter), and the result is chronological so the queue can put the newest on top.
 */
export function toastsFromEvents(events: readonly StarlingEvent[], ctx: ToastContext): ToastSpec[] {
  const nodes = nodeIndex(ctx.nodes);
  const specs: ToastSpec[] = [];
  for (const event of events) {
    const spec = toastForEvent(event, nodes);
    if (spec !== undefined) specs.push(spec);
  }
  const budget = budgetToast(events, ctx.budgetUsd);
  if (budget !== undefined) specs.push(budget);
  return dedupe(specs);
}
