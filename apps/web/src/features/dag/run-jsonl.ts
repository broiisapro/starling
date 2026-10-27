import type { AgentEvent, AuditVerdict, MergeResult, Plan, StarlingEvent, TaskRun } from '@starling/core';
import { isStarlingEvent } from '../../lib/events';

/**
 * Turn a recorded run (`*.jsonl`, one `StarlingEvent` per line) back into props for the playgrounds.
 *
 * Dev-only: the playgrounds read the committed fixture directly. The shell's store is the real
 * source for the dashboard, so nothing in the wired app imports this module.
 * Lines that are not plausible `StarlingEvent`s are skipped rather than crashing the page.
 *
 * The envelope guard is local (`src/lib/events.ts`) on purpose: a *runtime* import from
 * `@starling/core` drags its config loader (and `node:fs`) into the browser bundle.
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

function emptySlice(): ReplaySlice {
  return { tasks: {}, events: [], verdicts: [], merges: [] };
}

function applyEvent(slice: ReplaySlice, event: StarlingEvent): void {
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
    if (isStarlingEvent(raw)) applyEvent(slice, raw);
  }
  return slice;
}
