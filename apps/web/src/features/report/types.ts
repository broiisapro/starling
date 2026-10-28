import type { AuditCheck, ModelRef, RunStatus, TokenUsage } from '@starling/core/browser';

/**
 * The flight report's vocabulary (Epic 113).
 *
 * Everything here is derived from `SkyState` snapshots — never from a live endpoint — so the page
 * works in demo mode, from a replayed JSONL file and on a hub that predates Epic 111's report route.
 * `live.ts` may layer a server-owned report on top, field by field.
 */
export type FlightOutcome = 'landed' | 'partial' | 'failed' | 'in-flight' | 'cancelled';

/** Task counts by final state. `inFlight` is the remainder (pending/ready/running/auditing/…). */
export interface FlightTaskCounts {
  total: number;
  merged: number;
  failed: number;
  conflict: number;
  cancelled: number;
  inFlight: number;
}

/** One roost's share of the flight. `costUsd` is the sum of its tasks' recorded cost. */
export interface NodeContribution {
  nodeId: string;
  name: string;
  tasks: number;
  merged: number;
  flightMs: number;
  costUsd: number;
  migratedIn: number;
  migratedOut: number;
}

/**
 * An audit that pushed back: a failed attempt, a lane violation or explicit fix instructions.
 * `resolvedBy` is the attempt number that later passed, when there is one — that pairing is the
 * headline ("failed attempt 1 … passed on attempt 2").
 */
export interface NotableVerdict {
  taskKey: string;
  attempt: number;
  pass: boolean;
  checks: AuditCheck[];
  laneViolations: string[];
  summary: string;
  fixInstructions?: string;
  model: ModelRef;
  ts: number;
  resolvedBy?: number;
}

export type StoryKind =
  | 'repomap'
  | 'plan'
  | 'node.joined'
  | 'node.left'
  | 'running'
  | 'audit'
  | 'migrated'
  | 'merge'
  | 'conflict'
  | 'log'
  | 'finished';

/** `at` is milliseconds since the run started, so the timeline is independent of wall clocks. */
export interface StoryBeat {
  at: number;
  kind: StoryKind;
  text: string;
  taskKey?: string;
}

/**
 * The whole report. Every field is derivable from the run snapshot plus the active run's events;
 * fields listed in `estimated` are heuristics (see `derive.ts`) and must be labelled as such.
 */
export interface FlightReport {
  runId: string;
  /** The goal text the run was launched with. */
  goal: string;
  status: RunStatus;
  outcome: FlightOutcome;
  tasks: FlightTaskCounts;
  /** `finishedAt ?? now` minus `startedAt`. */
  wallMs: number;
  /** Newest task finish minus oldest task start: the window the flock actually overlapped in. */
  flightWindowMs: number;
  /** Overhead plus one-task-at-a-time work. An estimate, always. */
  serialMs: number;
  savedMs: number;
  speedup: number;
  costUsd: number;
  savedUsd: number;
  localCalls: number;
  tokens: { api: TokenUsage; local: TokenUsage };
  nodes: NodeContribution[];
  verdicts: NotableVerdict[];
  story: StoryBeat[];
  /** The writer model's run summary — only ever present on the `run.finished` event. */
  summary?: string;
  /** Names of the fields above that are estimates, so the UI can label them honestly. */
  estimated: string[];
}

/** Field ids used in `FlightReport.estimated`. The page renders them as the word "estimate". */
export const ESTIMATED_SERIAL = 'serialMs';
export const ESTIMATED_SAVED = 'savedMs';
export const ESTIMATED_SPEEDUP = 'speedup';
export const ESTIMATED_PLANNER = 'planner-estimate';

export const EMPTY_USAGE: TokenUsage = { input: 0, output: 0, cached: 0 };
