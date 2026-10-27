/**
 * Fixture / replay support: turn a JSONL event stream into the exact props `SkyView` needs at any
 * point in time. Used by the Playground (scrubbing the recorded launch-day run) and by the tests.
 *
 * This is deliberately a *reducer*, not a second store: `buildFrame(events, i)` rebuilds the frame
 * from scratch, so scrubbing backwards is as correct as playing forwards and no state leaks between
 * runs. It is O(events) per call, which is nothing for a 252-event fixture.
 */
import {
  type NodeInfo,
  type Run,
  type StarlingEvent,
  StarlingEventSchema,
  type TaskStatus,
} from '@starling/core';
import { TASK_STATUSES } from './palette';

/** The sim looks this far back for agent activity and migrations. */
export const RECENT_WINDOW_MS = 10_000;

export interface SkyFrame {
  run?: Run;
  nodes: NodeInfo[];
  recent: StarlingEvent[];
  index: number;
  ts: number;
}

/** Parse event JSONL, skipping blank and malformed lines rather than throwing a whole demo away. */
export function parseEventJsonl(text: string): StarlingEvent[] {
  const events: StarlingEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = StarlingEventSchema.safeParse(JSON.parse(trimmed));
      if (parsed.success) events.push(parsed.data);
    } catch {
      // A truncated recording tail is not a reason to lose the first 200 events.
    }
  }
  return events;
}

function copyRun(run: Run): Run {
  return { ...run, tasks: { ...run.tasks } };
}

/**
 * Fold events `0…index` into a `SkyFrame`. Copies the run (and its task record) so callers can hand
 * the frame to a component without ever mutating the parsed JSONL.
 */
export function buildFrame(
  events: readonly StarlingEvent[],
  index: number,
  opts: { windowMs?: number } = {},
): SkyFrame {
  const last = events.length - 1;
  const i = last < 0 ? -1 : Math.max(0, Math.min(last, Math.floor(index)));
  const ts = i >= 0 ? (events[i]?.ts ?? 0) : 0;
  const windowMs = opts.windowMs ?? RECENT_WINDOW_MS;

  let run: Run | undefined;
  const nodes = new Map<string, NodeInfo>();
  const recent: StarlingEvent[] = [];

  for (let k = 0; k <= i; k++) {
    const event = events[k];
    if (!event) continue;
    switch (event.type) {
      case 'run.created': {
        run = copyRun(event.payload.run);
        break;
      }
      case 'plan.created': {
        if (run) {
          run.plan = event.payload.plan;
          if (run.status === 'mapping') run.status = 'planned';
        }
        break;
      }
      case 'task.status': {
        if (run) run.tasks[event.payload.taskKey] = event.payload.run;
        break;
      }
      case 'audit.verdict': {
        if (run) {
          const task = run.tasks[event.payload.taskKey];
          if (task) task.lastVerdict = event.payload;
        }
        break;
      }
      case 'metrics': {
        if (run) run.metrics = event.payload;
        break;
      }
      case 'node.joined': {
        nodes.set(event.payload.node.id, event.payload.node);
        break;
      }
      case 'node.stats': {
        nodes.set(event.payload.node.id, event.payload.node);
        break;
      }
      case 'node.left': {
        const existing = nodes.get(event.payload.nodeId);
        if (existing) nodes.set(existing.id, { ...existing, status: 'offline' });
        break;
      }
      case 'run.finished': {
        run = copyRun(event.payload.run);
        break;
      }
      default:
        break;
    }
    if (ts - event.ts <= windowMs) recent.push(event);
  }

  return { run, nodes: [...nodes.values()], recent, index: i, ts };
}

/** Event index whose timestamp is closest to `ts` (the Playground's playhead). */
export function indexAtTs(events: readonly StarlingEvent[], ts: number): number {
  if (events.length === 0) return 0;
  let lo = 0;
  let hi = events.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((events[mid]?.ts ?? 0) < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The next/previous event index worth stopping on while scrubbing: status changes, merge results,
 * node churn and the end of the run. Playground buttons use this to step between beats.
 */
const BEATS = new Set<string>(['task.status', 'merge.result', 'node.joined', 'node.left', 'run.finished']);

export function nextBeat(events: readonly StarlingEvent[], from: number, direction: 1 | -1): number {
  for (let i = from + direction; i >= 0 && i < events.length; i += direction) {
    if (BEATS.has(events[i]?.type ?? '')) return i;
  }
  return from;
}

/** Task counts per status for the accessible summary and the Playground legend. */
export function statusCounts(run: Run | undefined): Record<TaskStatus, number> {
  const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
  if (!run) return counts;
  for (const task of Object.values(run.tasks)) counts[task.status] += 1;
  return counts;
}

/** Human sentence for aria-live: "7 tasks: 4 merged, 2 running, 1 auditing · 2 machines". */
export function describeSky(run: Run | undefined, nodes: readonly NodeInfo[]): string {
  const counts = statusCounts(run);
  const total = run ? Object.keys(run.tasks).length : 0;
  const states = TASK_STATUSES.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`);
  const online = nodes.filter((n) => n.status !== 'offline').length;
  const machines = `${online} ${online === 1 ? 'machine' : 'machines'}`;
  if (total === 0) return `No run. ${machines}.`;
  return `${total} ${total === 1 ? 'task' : 'tasks'}: ${states.join(', ')} · ${machines}`;
}
