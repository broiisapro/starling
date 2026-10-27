/**
 * Starling ports — the only coupling between packages (ARCHITECTURE §6, LOCKED).
 *
 * Wave 1 packages implement these interfaces; the engine talks to nothing else. Mocks for every
 * port live in `@starling/core/testing`.
 */
import type { ZodType } from 'zod';
import type {
  AgentEvent,
  AuditVerdict,
  DiffSummary,
  Goal,
  MergeResult,
  ModelRef,
  ModelRole,
  NodeInfo,
  Plan,
  PlanIssue,
  RepoMap,
  Run,
  StarlingEvent,
  StartTaskOptions,
  TaskHandle,
  TaskResult,
  TaskRun,
  TaskSpec,
  TokenUsage,
} from './contracts';

export interface LLMRequest {
  role: ModelRole;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse<T = unknown> {
  text: string;
  parsed?: T;
  usage: TokenUsage;
  model: ModelRef;
  costUsd: number;
  local: boolean;
}

export interface LLM {
  complete(req: LLMRequest): Promise<LLMResponse>;
  completeJson<T>(req: LLMRequest, schema: ZodType<T>): Promise<LLMResponse<T>>;
}

export interface RepoMapper {
  map(repoPath: string, opts?: { summarize?: boolean; maxFiles?: number }): Promise<RepoMap>;
}

export interface Planner {
  plan(goal: Goal, map: RepoMap): Promise<{ plan: Plan; issues: PlanIssue[] }>;
  validate(plan: Plan): PlanIssue[];
}

export interface PromptContext {
  goal: Goal;
  plan: Plan;
  map: RepoMap;
  task: TaskSpec;
  branch: string;
  testCommand?: string;
}

export interface PromptCompiler {
  worker(ctx: PromptContext): string;
  fixer(ctx: PromptContext, verdict: AuditVerdict): string;
  resolver(ctx: PromptContext, conflict: MergeResult): string;
}

export interface Workspace {
  ensureIntegrationBranch(repo: string, base: string, name: string): Promise<void>;
  create(repo: string, branch: string, fromRef: string): Promise<{ path: string; branch: string }>;
  diff(worktreePath: string, baseRef: string): Promise<DiffSummary>;
  changedFiles(worktreePath: string, baseRef: string): Promise<string[]>;
  predictConflicts(repo: string, ours: string, theirs: string): Promise<string[]>;
  commitAll(worktreePath: string, message: string): Promise<string | undefined>;
  remove(worktreePath: string): Promise<void>;
}

export interface AgentRunner {
  start(opts: {
    runId: string;
    taskKey: string;
    dir: string;
    prompt: string;
    model: ModelRef;
    title: string;
  }): Promise<{ sessionId: string }>;
  send(sessionId: string, prompt: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
  onEvent(fn: (e: AgentEvent) => void): () => void;
  close(): Promise<void>;
}

export interface AuditInput {
  ctx: PromptContext;
  run: TaskRun;
  diff: DiffSummary;
  changedFiles: string[];
  attempt: number;
}

export interface Auditor {
  audit(input: AuditInput): Promise<AuditVerdict>;
}

export interface Merger {
  merge(
    repo: string,
    integrationBranch: string,
    run: TaskRun,
    opts: { testCommand?: string },
  ): Promise<MergeResult>;
}

export interface Tracker {
  syncPlan(run: Run): Promise<Record<string, number>>;
  openTaskPR(run: Run, task: TaskRun, body: string): Promise<string | undefined>;
  onMerged(run: Run, task: TaskRun): Promise<void>;
  openFinalPR(run: Run, body: string): Promise<string | undefined>;
}

export interface Store {
  saveRun(run: Run): void;
  getRun(id: string): Run | undefined;
  listRuns(): Run[];
  appendEvent(e: StarlingEvent): void;
  events(runId: string, sinceTs?: number): StarlingEvent[];
  exportJsonl(runId: string, path: string): void;
}

export interface EventBus {
  publish(e: StarlingEvent): void;
  subscribe(fn: (e: StarlingEvent) => void): () => void;
}

export interface ExecutionNode {
  readonly id: string;
  info(): Promise<NodeInfo>;
  startTask(opts: StartTaskOptions): Promise<TaskHandle>;
  sendPrompt(h: TaskHandle, prompt: string): Promise<void>;
  abort(h: TaskHandle): Promise<void>;
  collect(h: TaskHandle, hubRepo: string, baseRef: string): Promise<TaskResult>;
  cleanup(h: TaskHandle): Promise<void>;
  onEvent(fn: (e: AgentEvent) => void): () => void;
}

export interface NodeRegistry {
  list(): NodeInfo[];
  get(id: string): ExecutionNode | undefined;
  onChange(fn: (e: { type: 'joined' | 'left' | 'stats'; node: NodeInfo }) => void): () => void;
}

export interface Scheduler {
  pick(nodes: NodeInfo[], task: TaskSpec): string | undefined;
}

export interface Clock {
  now(): number;
}
