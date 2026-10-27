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

/**
 * Per-call controls. Optional everywhere, so an implementation may ignore them and an existing
 * caller that passes nothing keeps working (ARCHITECTURE §6 `LLM`).
 */
export interface LLMCallOptions {
  /** Cancel an in-flight call (a cancelled run must not keep paying for tokens). */
  signal?: AbortSignal;
  /** Deadline for this call alone; the router defaults to 120 s. */
  timeoutMs?: number;
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
  complete(req: LLMRequest, opts?: LLMCallOptions): Promise<LLMResponse>;
  completeJson<T>(req: LLMRequest, schema: ZodType<T>, opts?: LLMCallOptions): Promise<LLMResponse<T>>;
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

/**
 * Conflict prediction for a task branch, without touching a worktree, a ref or the index.
 *
 * `alreadyMerged` means the engine can skip the merge entirely; `clean` means `git merge-tree`
 * found no conflicts (the real merge can still fail on a dirty worktree or failing tests).
 */
export interface MergePreflight {
  clean: boolean;
  conflictedFiles: string[];
  alreadyMerged: boolean;
  detail: string;
}

export interface Merger {
  merge(
    repo: string,
    integrationBranch: string,
    run: TaskRun,
    opts: { testCommand?: string },
  ): Promise<MergeResult>;
  /** Optional: implementations that can predict conflicts expose it, the engine probes for it. */
  preflight?(repo: string, integrationBranch: string, branch: string): Promise<MergePreflight>;
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
  onChange(fn: (e: NodeRegistryEvent) => void): () => void;
}

/** A registry notification. `reason` is set for `left` so the engine can tell a timeout from a goodbye. */
export interface NodeRegistryEvent {
  type: 'joined' | 'left' | 'stats';
  node: NodeInfo;
  reason?: string;
}

export interface Scheduler {
  pick(nodes: NodeInfo[], task: TaskSpec): string | undefined;
}

export interface Clock {
  now(): number;
}

// ── flock transports (ARCHITECTURE §1 "Repo transfer", L18/L19) ──────────────────────────────────

/**
 * Git bundles: how commits move between the hub and a perch without a shared filesystem, SSH or a
 * GitHub round trip. The hub bundles a ref, the perch clones it and bundles its branch back, and the
 * hub fetches that bundle into the real repo.
 */
export interface BundleOps {
  /**
   * Write a bundle of `ref` and return its absolute path. With `base`, the bundle is the thin
   * `base..ref` range, which is what a perch sends back after a task.
   */
  createBundle(repo: string, ref: string, opts?: { base?: string; outPath?: string }): Promise<string>;
  /** Clone a bundle into `dir` and check out `ref` as a local branch. */
  cloneFromBundle(bundlePath: string, dir: string, ref: string): Promise<{ path: string; branch: string }>;
  /** Fetch `ref` from a bundle into the local branch `intoBranch`, forcing the update. */
  fetchBundle(repo: string, bundlePath: string, ref: string, intoBranch: string): Promise<void>;
}

/** One service to publish on the LAN. `type` defaults to `_starling._tcp`. */
export interface MdnsAdvertiseOptions {
  /** Human-readable service name, e.g. "Moksh's MacBook Air". */
  name: string;
  /** Bonjour service type. Defaults to `_starling._tcp`. */
  type?: string;
  /** TCP port the Perch API listens on. */
  port: number;
  /** TXT records. The perch publishes its join code and node name here. */
  txt?: Record<string, string>;
}

/**
 * Advertise this node over mDNS (ARCHITECTURE L19). Implementations must be safe to stop twice;
 * `stop()` unpublishes the service and releases the socket.
 */
export interface MdnsAdvertiser {
  advertise(opts: MdnsAdvertiseOptions): void | Promise<void>;
  stop(): void | Promise<void>;
}

/** A perch found on the LAN. */
export interface DiscoveredPerch {
  /** Advertised service name, e.g. "Moksh's MacBook Air". */
  name: string;
  /** Reachable host (IPv4 address when mDNS gave us one, otherwise the `.local` hostname). */
  host: string;
  port: number;
  /** TXT records as strings, e.g. `{ role: 'perch', node: '<ulid>' }`. */
  txt: Record<string, string>;
}

/**
 * Browse for perches over mDNS. The manual `starling perch --hub … --code …` path never needs this,
 * so a blocked multicast socket degrades to typing a code rather than failing.
 */
export interface MdnsBrowser {
  /** Start browsing; `onFound` fires for each advertised perch. Returns a stop function. */
  browse(onFound: (perch: DiscoveredPerch) => void): () => void;
  close(): void;
}
