/**
 * Starling contracts — the frozen vocabulary every package shares.
 *
 * Rules for this file (ARCHITECTURE §6, LOCKED):
 * - zod-first: every type is inferred from its schema, so the two cannot drift.
 * - Every type has a matching `<Type>Schema` export.
 * - Field names and literal unions match `.orchestrator/ARCHITECTURE.md` §6 exactly.
 * - Timestamps are epoch milliseconds. IDs are ULIDs (lowercase strings).
 */
import { z } from 'zod';

// ── models ────────────────────────────────────────────────────────────────────────────────────────
export const ModelRoleSchema = z.enum(['planner', 'worker', 'resolver', 'auditor', 'summarizer', 'writer']);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelRefSchema = z.object({
  provider: z.string(),
  model: z.string(),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const TokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cached: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

// ── goal / plan ───────────────────────────────────────────────────────────────────────────────────
export const GoalSchema = z.object({
  id: z.string(),
  text: z.string(),
  repoPath: z.string(),
  baseBranch: z.string(),
  createdAt: z.number(),
  constraints: z.array(z.string()),
});
export type Goal = z.infer<typeof GoalSchema>;

export const LaneSchema = z.object({
  owns: z.array(z.string()),
  reads: z.array(z.string()),
});
export type Lane = z.infer<typeof LaneSchema>;

export const TaskSpecSchema = z.object({
  key: z.string(),
  title: z.string(),
  goal: z.string(),
  deliverables: z.array(z.string()),
  outOfScope: z.array(z.string()),
  definitionOfDone: z.array(z.string()),
  dependsOn: z.array(z.string()),
  lane: LaneSchema,
  estimateMin: z.number(),
});
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

export const PlanSchema = z.object({
  id: z.string(),
  goalId: z.string(),
  summary: z.string(),
  tasks: z.array(TaskSpecSchema),
  lockedDecisions: z.array(z.string()),
  model: ModelRefSchema,
  createdAt: z.number(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const PlanIssueCodeSchema = z.enum([
  'cycle',
  'lane-overlap',
  'missing-dep',
  'empty-dod',
  'empty-lane',
  'other',
]);
export type PlanIssueCode = z.infer<typeof PlanIssueCodeSchema>;

export const PlanIssueSchema = z.object({
  severity: z.enum(['error', 'warn']),
  code: PlanIssueCodeSchema,
  message: z.string(),
  taskKeys: z.array(z.string()),
});
export type PlanIssue = z.infer<typeof PlanIssueSchema>;

// ── repo map ──────────────────────────────────────────────────────────────────────────────────────
export const RepoFileSchema = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  lang: z.string(),
  symbols: z.array(z.string()),
  summary: z.string().optional(),
});
export type RepoFile = z.infer<typeof RepoFileSchema>;

export const RepoMapSchema = z.object({
  root: z.string(),
  tree: z.string(),
  files: z.array(RepoFileSchema),
  languages: z.record(z.string(), z.number()),
  testCommand: z.string().optional(),
  lintCommand: z.string().optional(),
  tokenEstimate: z.number().int().nonnegative(),
  createdAt: z.number(),
});
export type RepoMap = z.infer<typeof RepoMapSchema>;

// ── runs ──────────────────────────────────────────────────────────────────────────────────────────
export const TaskStatusSchema = z.enum([
  'pending',
  'ready',
  'running',
  'auditing',
  'fixing',
  'merging',
  'merged',
  'failed',
  'conflict',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const DiffSummarySchema = z.object({
  files: z.array(z.object({ path: z.string(), added: z.number().int(), removed: z.number().int() })),
  patch: z.string(),
  truncated: z.boolean(),
});
export type DiffSummary = z.infer<typeof DiffSummarySchema>;

export const AuditCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string(),
});
export type AuditCheck = z.infer<typeof AuditCheckSchema>;

export const AuditVerdictSchema = z.object({
  taskKey: z.string(),
  attempt: z.number().int().nonnegative(),
  pass: z.boolean(),
  checks: z.array(AuditCheckSchema),
  laneViolations: z.array(z.string()),
  summary: z.string(),
  fixInstructions: z.string().optional(),
  model: ModelRefSchema,
  ts: z.number(),
});
export type AuditVerdict = z.infer<typeof AuditVerdictSchema>;

export const TaskRunSchema = z.object({
  runId: z.string(),
  taskKey: z.string(),
  status: TaskStatusSchema,
  branch: z.string().optional(),
  worktreePath: z.string().optional(),
  sessionId: z.string().optional(),
  attempts: z.number().int().nonnegative(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  usage: TokenUsageSchema,
  costUsd: z.number(),
  issueNumber: z.number().int().optional(),
  prUrl: z.string().optional(),
  lastVerdict: AuditVerdictSchema.optional(),
  nodeId: z.string().optional(),
});
export type TaskRun = z.infer<typeof TaskRunSchema>;

// ── flock (distributed execution) ────────────────────────────────────────────────────────────────
export const NodeStatusSchema = z.enum(['online', 'busy', 'offline']);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const NodeInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['local', 'remote']),
  url: z.string().optional(),
  platform: z.string(),
  arch: z.string(),
  cpuCores: z.number().int().nonnegative(),
  memGb: z.number().nonnegative(),
  maxSessions: z.number().int().nonnegative(),
  activeSessions: z.number().int().nonnegative(),
  localModels: z.array(z.string()),
  status: NodeStatusSchema,
  lastSeen: z.number(),
  latencyMs: z.number().optional(),
});
export type NodeInfo = z.infer<typeof NodeInfoSchema>;

export const TaskHandleSchema = z.object({
  nodeId: z.string(),
  runId: z.string(),
  taskKey: z.string(),
  branch: z.string(),
  sessionId: z.string(),
});
export type TaskHandle = z.infer<typeof TaskHandleSchema>;

export const StartTaskOptionsRepoSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local'), path: z.string() }),
  z.object({ kind: z.literal('bundle'), url: z.string(), token: z.string() }),
]);
export type StartTaskOptionsRepo = z.infer<typeof StartTaskOptionsRepoSchema>;

export const StartTaskOptionsSchema = z.object({
  runId: z.string(),
  taskKey: z.string(),
  title: z.string(),
  repo: StartTaskOptionsRepoSchema,
  fromRef: z.string(),
  branch: z.string(),
  prompt: z.string(),
  model: ModelRefSchema,
});
export type StartTaskOptions = z.infer<typeof StartTaskOptionsSchema>;

export const TaskResultSchema = z.object({
  commit: z.string(),
  diff: DiffSummarySchema,
  changedFiles: z.array(z.string()),
  bundlePath: z.string().optional(),
});
export type TaskResult = z.infer<typeof TaskResultSchema>;

export const RunMetricsSchema = z.object({
  agentsActive: z.number().int().nonnegative(),
  tasksMerged: z.number().int().nonnegative(),
  tasksFailed: z.number().int().nonnegative(),
  apiUsage: TokenUsageSchema,
  localUsage: TokenUsageSchema,
  apiCostUsd: z.number(),
  localCallCount: z.number().int().nonnegative(),
  estSavedUsd: z.number(),
  elapsedMs: z.number(),
});
export type RunMetrics = z.infer<typeof RunMetricsSchema>;

export const RunStatusSchema = z.enum([
  'mapping',
  'planning',
  'planned',
  'running',
  'finished',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunSchema = z.object({
  id: z.string(),
  goal: GoalSchema,
  plan: PlanSchema.optional(),
  tasks: z.record(z.string(), TaskRunSchema),
  status: RunStatusSchema,
  integrationBranch: z.string().optional(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  metrics: RunMetricsSchema,
});
export type Run = z.infer<typeof RunSchema>;

// ── agent events (normalized from opencode SSE) ───────────────────────────────────────────────────
export const AgentEventKindSchema = z.enum([
  'session.started',
  'text',
  'tool.call',
  'tool.result',
  'file.edited',
  'usage',
  'session.idle',
  'session.error',
]);
export type AgentEventKind = z.infer<typeof AgentEventKindSchema>;

export const AgentEventSchema = z.object({
  runId: z.string(),
  taskKey: z.string(),
  sessionId: z.string(),
  ts: z.number(),
  kind: AgentEventKindSchema,
  data: z.record(z.string(), z.unknown()),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ── audit / merge ────────────────────────────────────────────────────────────────────────────────
export const MergeResultSchema = z.object({
  taskKey: z.string(),
  status: z.enum(['merged', 'conflict', 'tests-failed', 'skipped']),
  conflictedFiles: z.array(z.string()),
  commit: z.string().optional(),
  detail: z.string(),
  ts: z.number(),
});
export type MergeResult = z.infer<typeof MergeResultSchema>;

// ── the event bus envelope (everything the UI sees) ──────────────────────────────────────────────
export const StarlingEventTypeSchema = z.enum([
  'run.created',
  'repomap.ready',
  'plan.created',
  'task.status',
  'agent.event',
  'audit.verdict',
  'merge.result',
  'metrics',
  'log',
  'node.joined',
  'node.left',
  'node.stats',
  'task.migrated',
  'run.finished',
]);
export type StarlingEventType = z.infer<typeof StarlingEventTypeSchema>;

const envelope = { runId: z.string(), ts: z.number() };

export const StarlingEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('run.created'),
    ...envelope,
    payload: z.object({ run: RunSchema }),
  }),
  z.object({
    type: z.literal('repomap.ready'),
    ...envelope,
    payload: z.object({
      files: z.number().int().nonnegative(),
      tokenEstimate: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    type: z.literal('plan.created'),
    ...envelope,
    payload: z.object({ plan: PlanSchema, issues: z.array(PlanIssueSchema) }),
  }),
  z.object({
    type: z.literal('task.status'),
    ...envelope,
    payload: z.object({
      taskKey: z.string(),
      from: TaskStatusSchema,
      to: TaskStatusSchema,
      run: TaskRunSchema,
    }),
  }),
  z.object({
    type: z.literal('agent.event'),
    ...envelope,
    payload: AgentEventSchema,
  }),
  z.object({
    type: z.literal('audit.verdict'),
    ...envelope,
    payload: AuditVerdictSchema,
  }),
  z.object({
    type: z.literal('merge.result'),
    ...envelope,
    payload: MergeResultSchema,
  }),
  z.object({
    type: z.literal('metrics'),
    ...envelope,
    payload: RunMetricsSchema,
  }),
  z.object({
    type: z.literal('log'),
    ...envelope,
    payload: z.object({
      level: z.enum(['debug', 'info', 'warn', 'error']),
      msg: z.string(),
      taskKey: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('node.joined'),
    ...envelope,
    payload: z.object({ node: NodeInfoSchema }),
  }),
  z.object({
    type: z.literal('node.left'),
    ...envelope,
    payload: z.object({ nodeId: z.string(), reason: z.string() }),
  }),
  z.object({
    type: z.literal('node.stats'),
    ...envelope,
    payload: z.object({ node: NodeInfoSchema }),
  }),
  z.object({
    type: z.literal('task.migrated'),
    ...envelope,
    payload: z.object({ taskKey: z.string(), fromNode: z.string(), toNode: z.string(), reason: z.string() }),
  }),
  z.object({
    type: z.literal('run.finished'),
    ...envelope,
    payload: z.object({ run: RunSchema, summary: z.string() }),
  }),
]);
export type StarlingEvent = z.infer<typeof StarlingEventSchema>;

/** Narrow an event to the arm with `type === T`. Handy in switch-heavy UI and store code. */
export type StarlingEventOf<T extends StarlingEventType> = Extract<StarlingEvent, { type: T }>;
