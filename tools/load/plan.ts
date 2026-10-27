/**
 * Synthetic swarm input: a 30-task, lane-disjoint DAG plus ~300 scripted `AgentEvent`s per task.
 *
 * The plan is expressed as a `PlanDraft` so it goes through the **real** `@starling/planner`
 * (`createPlanner`) and its validator; only the model answer is mocked. That keeps the load test
 * honest about plan normalisation, DAG construction and lane checks while costing exactly nothing.
 *
 * Shapes rather than real content: each task owns `src/task-NN/**` and its agent "edits"
 * `src/task-NN/index.ts`. Two waves of work keep the dispatcher busy without making the run long:
 * tasks 1–20 are independent, tasks 21–30 each wait for one of the first ten.
 */
import type { AgentEvent, AgentEventKind, TaskSpec } from '../../packages/core/src/index.ts';
import type { PlanDraft } from '../../packages/planner/src/index.ts';

/** Exactly this many events per task: ~300, as the assignment asks. */
export const EVENTS_PER_TASK = 300;
/** Recorded wall-clock span of one task, divided by the replay speed at run time. */
export const TASK_SPAN_MS = 1_600;

export const TASK_COUNT = 30;
/** Tasks `0..INDEPENDENT-1` are roots; the rest depend on one of them. */
export const INDEPENDENT_TASKS = 20;

export const LOAD_MODEL = { provider: 'deepseek', model: 'deepseek-v4.1-flash' } as const;

const TITLES = [
  'Add the search input',
  'Wire the filter chips',
  'Extract the date helper',
  'Fix the overdue calculation',
  'Add the CSV exporter',
  'Persist the theme choice',
  'Add the empty state',
  'Split the settings panel',
  'Debounce the query box',
  'Cache the project list',
  'Add keyboard shortcuts',
  'Normalise tag casing',
  'Add the undo stack',
  'Improve the loading skeleton',
  'Guard the delete action',
  'Add the bulk selector',
  'Group the activity feed',
  'Add the progress bar',
  'Trim the bundle entry',
  'Document the API client',
] as const;

export function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

export function taskKeyFor(index: number): string {
  return `t${pad2(index + 1)}-${slug(TITLES[index % TITLES.length] ?? 'task')}`;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The file a simulated agent writes; also the lane it must stay inside. */
export function fileForTask(key: string): string {
  const match = /^t(\d{2})/.exec(key);
  return `src/task-${match?.[1] ?? '99'}/index.ts`;
}

export function buildTaskSpecs(count = TASK_COUNT): TaskSpec[] {
  return Array.from({ length: count }, (_, index) => {
    const key = taskKeyFor(index);
    const dir = `src/task-${pad2(index + 1)}/**`;
    const dependency = index >= INDEPENDENT_TASKS ? taskKeyFor(index - INDEPENDENT_TASKS) : undefined;
    return {
      key,
      title: `${TITLES[index % TITLES.length] ?? 'Task'} (#${index + 1})`,
      goal: `Implement ${TITLES[index % TITLES.length] ?? 'the feature'} in ${dir}, with no changes outside the lane.`,
      deliverables: [fileForTask(key), 'Unit test for the new behaviour'],
      outOfScope: ['Touching any other task lane', 'Adding dependencies'],
      definitionOfDone: [
        'bun run test passes',
        `${fileForTask(key)} exists and exports the feature`,
        'No files outside src/task-NN/** change',
      ],
      dependsOn: dependency === undefined ? [] : [dependency],
      lane: { owns: [dir], reads: ['package.json'] },
      estimateMin: 5,
    };
  });
}

/** The plan draft the mocked planner model returns. */
export function buildPlanDraft(count = TASK_COUNT): PlanDraft {
  return {
    summary: `Thirty lane-disjoint changes across src/task-NN, twenty in the first wave and ten behind dependencies.`,
    lockedDecisions: ['Vanilla TypeScript', 'Every task owns exactly one src/task-NN/** lane'],
    tasks: buildTaskSpecs(count),
  };
}

/** Small deterministic RNG (mulberry32) so two runs produce the same scripted transcripts. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const USAGE_INPUT = 640;
const USAGE_OUTPUT = 96;

function eventKindFor(index: number): AgentEventKind {
  switch (index % 8) {
    case 2:
    case 6:
      return 'tool.call';
    case 3:
    case 7:
      return 'tool.result';
    case 5:
      return 'file.edited';
    default:
      return 'text';
  }
}

function eventData(kind: AgentEventKind, index: number, taskKey: string): Record<string, unknown> {
  switch (kind) {
    case 'text':
      return {
        text: `Step ${index}: updating ${taskKey} and checking the lane boundary before the next edit.`,
      };
    case 'tool.call':
      return { tool: index % 3 === 0 ? 'read' : 'edit', path: fileForTask(taskKey), callId: `c${index}` };
    case 'tool.result':
      return { tool: 'edit', ok: true, callId: `c${index - 1}`, bytes: 512 };
    case 'file.edited':
      return { path: fileForTask(taskKey), added: 18, removed: 2 };
    case 'usage':
      return { input: USAGE_INPUT, output: USAGE_OUTPUT, cached: 0, model: LOAD_MODEL };
    case 'session.started':
      return { model: LOAD_MODEL, title: taskKey };
    case 'session.error':
      return { reason: 'unused in the happy path' };
    case 'session.idle':
      return { reason: 'stop' };
  }
}

/**
 * One task's scripted transcript: `session.started`, a long run of text/tool/edit events, some
 * `usage` samples, and a final `session.idle`. Exactly `EVENTS_PER_TASK` events, roughly one every
 * `TASK_SPAN_MS / EVENTS_PER_TASK` ms of recorded time.
 *
 * `runId`/`sessionId` are placeholders: `ReplayRunner` remaps them to the real session.
 */
export function buildScriptedEvents(
  taskKey: string,
  options: { count?: number; spanMs?: number; seed?: number } = {},
): AgentEvent[] {
  const count = Math.max(3, options.count ?? EVENTS_PER_TASK);
  const spanMs = options.spanMs ?? TASK_SPAN_MS;
  const random = seededRandom(options.seed ?? 7);
  const baseTs = 1_700_000_000_000;

  const events: AgentEvent[] = [];
  for (let index = 0; index < count; index += 1) {
    const kind: AgentEventKind =
      index === 0 ? 'session.started' : index === count - 1 ? 'session.idle' : eventKindFor(index);
    events.push({
      runId: 'scripted-run',
      taskKey,
      sessionId: 'scripted-session',
      // Jitter keeps transcripts from being perfectly periodic without making them unreproducible.
      ts: baseTs + Math.round((index * spanMs) / count) + Math.floor(random() * 3),
      kind,
      data: eventData(kind, index, taskKey),
    });
  }

  // Usage samples are what the engine's cost ledger reads; sprinkle them through the transcript.
  for (let index = 20; index < count - 1; index += 15) {
    const event = events[index];
    if (event === undefined) continue;
    events[index] = {
      ...event,
      kind: 'usage',
      data: eventData('usage', index, taskKey),
    };
  }
  return events;
}
