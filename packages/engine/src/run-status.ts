/**
 * `run.status` and `TaskRun.nodeName` — both are additive core fields owned by Epic 40 (L30).
 *
 * The engine cannot edit `packages/core`, so it **feature-detects** the event: it builds the candidate
 * shapes and keeps the first one core's `StarlingEventSchema` accepts (the schema is the contract's
 * own truth). Since C2 core accepts `{ from, to, run }`, so every status change is published; against
 * an older core the probe still yields `undefined` and nothing goes on the bus, which keeps replays
 * valid either way.
 *
 * `nodeName` rides on the task object as an additive property (core's `TaskRunSchema` ignores unknown
 * keys on save), so the UI can show "M2 Air" today and a future core field will simply take over.
 */
import type { NodeInfo, Run, RunStatus, StarlingEvent, TaskRun } from '@starling/core';
import { StarlingEventSchema } from '@starling/core';

/** The subset of `Run` the event carries. */
export interface RunStatusPayload {
  from?: RunStatus;
  to: RunStatus;
  run: Run;
}

export type EventAcceptor = (event: unknown) => boolean;

const acceptsByCoreSchema: EventAcceptor = (event) => StarlingEventSchema.safeParse(event).success;

/** Every candidate shape, most likely first. Epic 40's contract picks one of these. */
export function runStatusCandidates(
  runId: string,
  ts: number,
  from: RunStatus | undefined,
  run: Run,
): Array<{ type: 'run.status'; runId: string; ts: number; payload: Record<string, unknown> }> {
  const payloads: Array<Record<string, unknown>> = [
    { status: run.status, previous: from, run },
    { from, to: run.status, run },
    { status: run.status, run },
    { to: run.status, run },
    { run },
  ];
  return payloads.map((payload) => ({ type: 'run.status', runId, ts, payload }));
}

/**
 * Build a `run.status` event when core understands one, else `undefined`.
 *
 * `accept` is injectable so the probe itself is unit-testable against a future shape without
 * touching core.
 */
export function runStatusEvent(
  runId: string,
  ts: number,
  from: RunStatus | undefined,
  run: Run,
  accept: EventAcceptor = acceptsByCoreSchema,
): StarlingEvent | undefined {
  for (const candidate of runStatusCandidates(runId, ts, from, run)) {
    if (accept(candidate)) return candidate as unknown as StarlingEvent;
  }
  return undefined;
}

/** The task patch that records which node ran a task, without touching core's `TaskRunSchema`. */
export function nodeNamePatch(info: NodeInfo): Partial<TaskRun> & { nodeName: string } {
  return { nodeName: info.name };
}

/** Read back the additive name (tests and the UI both go through this). */
export function nodeNameOf(task: TaskRun | undefined): string | undefined {
  const value = (task as unknown as Record<string, unknown> | undefined)?.nodeName;
  return typeof value === 'string' ? value : undefined;
}

export interface ResumeSource {
  /** Last commit collected for this task, if any. */
  commit?: string;
  /** The task's own branch in the hub repo. */
  branch: string;
}

/**
 * Where a (re)dispatched task starts from.
 *
 * Normal dispatch branches off the integration branch. A task that already produced a commit before
 * its perch vanished resumes from **its own branch**, so the collected work is kept instead of being
 * silently redone from scratch.
 */
export function fromRefFor(source: ResumeSource, integrationBranch: string): string {
  return source.commit === undefined ? integrationBranch : source.branch;
}
