import type { AgentEvent, AuditVerdict, MergeResult, Plan, StarlingEvent, TaskRun } from '@starling/core';
import { StarlingEventSchema } from '@starling/core';

/**
 * Turn a recorded run (`*.jsonl`, one `StarlingEvent` per line) back into props for the playgrounds.
 *
 * Wave 1 has no store or replay client in the web app yet, so the playground reads the committed
 * fixture directly. At C1 this module disappears and the shell feeds the same props from the store.
 * Lines that fail the production schema are skipped rather than crashing the page.
 */
export interface ReplaySlice {
  runId?: string;
  goalText?: string;
  plan?: Plan;
  tasks: Record<string, TaskRun>;
  events: AgentEvent[];
  verdicts: AuditVerdict[];
  merges: MergeResult[];
}

export function emptySlice(): ReplaySlice {
  return { tasks: {}, events: [], verdicts: [], merges: [] };
}

export function applyEvent(slice: ReplaySlice, event: StarlingEvent): void {
  switch (event.type) {
    case 'run.created': {
      slice.runId = event.runId;
      slice.goalText = event.payload.run.goal.text;
      slice.plan = event.payload.run.plan;
      slice.tasks = { ...event.payload.run.tasks };
      break;
    }
    case 'plan.created': {
      slice.plan = event.payload.plan;
      break;
    }
    case 'task.status': {
      slice.tasks = { ...slice.tasks, [event.payload.taskKey]: event.payload.run };
      break;
    }
    case 'agent.event': {
      slice.events.push(event.payload);
      break;
    }
    case 'audit.verdict': {
      slice.verdicts.push(event.payload);
      break;
    }
    case 'merge.result': {
      slice.merges.push(event.payload);
      break;
    }
    case 'run.finished': {
      slice.runId = event.payload.run.id;
      slice.tasks = { ...event.payload.run.tasks };
      break;
    }
    default:
      break;
  }
}

export function parseRunJsonl(text: string): ReplaySlice {
  const slice = emptySlice();
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = StarlingEventSchema.safeParse(raw);
    if (parsed.success) applyEvent(slice, parsed.data);
  }
  return slice;
}
