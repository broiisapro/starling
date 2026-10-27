/**
 * Wave 1 handshake interfaces (ARCHITECTURE §8), now owned by core.
 *
 * These sit between packages that were built in parallel: the engine's API (consumed by the server
 * and the CLI), the flock hub (consumed by the server, the engine and the CLI), and the plain props
 * each web feature takes (the shell wires the store to them). They are **types only** — this module
 * emits no runtime code, which is what lets `@starling/core/browser` include it.
 *
 * Every Wave 1 package's local `src/handshake.ts` mirror is now a one-line re-export from here, so
 * there is exactly one definition of each interface in the repo.
 */
import type {
  AgentEvent,
  AuditVerdict,
  DiffSummary,
  MergeResult,
  NodeInfo,
  Plan,
  Run,
  RunMetrics,
  StarlingEvent,
  TaskRun,
  TaskSpec,
} from './contracts';
import type { NodeRegistry } from './ports';

// ── Engine API: implemented by packages/engine (E20); consumed by apps/server (E21) + apps/cli (E22)
export interface StartRunInput {
  goal: string;
  repoPath: string;
  dryRun?: boolean;
  maxParallel?: number;
  baseBranch?: string;
}

export interface EngineApi {
  /** Resolves once the run is created; work continues asynchronously. */
  start(input: StartRunInput): Promise<{ runId: string }>;
  cancel(runId: string): Promise<void>;
  abortTask(runId: string, taskKey: string): Promise<void>;
  getRun(runId: string): Run | undefined;
  /** Most recent first. */
  listRuns(): Run[];
  /** The CLI uses this for `starling run`. */
  waitForFinish(runId: string): Promise<Run>;
}

// ── Flock hub: implemented by packages/flock (E30); consumed by apps/server (E21), engine (E20), cli (E22)
export interface JoinInfo {
  code: string;
  hubUrl: string;
  /** The command a second laptop runs, e.g. `starling perch --hub <url> --code <code>`. */
  command: string;
}

export interface FlockHub {
  /** Includes the hub's own LocalNode with id 'hub'. */
  registry: NodeRegistry;
  joinInfo(): JoinInfo;
  verifyToken(token: string | undefined): boolean;
  register(input: { url: string; info: NodeInfo }): Promise<{ nodeId: string }>;
  heartbeat(input: { nodeId: string; info: NodeInfo }): void;
  /** A git bundle file of `ref` from the active repo. */
  bundle(ref: string): Promise<{ path: string }>;
  setActiveRepo(repoPath: string): void;
  close(): Promise<void>;
}

// ── Bundle URL: how the engine (E20) tells a RemoteNode where to fetch the repo.
//    The server path is §6 `GET /api/flock/bundle`.
export type BundleUrlFor = (ref: string) => { url: string; token: string };

// ── Web feature components: each feature epic exports exactly these from its feature folder's index.ts.
//    They take plain props (core types only) and NEVER read the global store. The shell (E23) wires
//    store → props.
export interface SkyViewProps {
  run?: Run;
  nodes: NodeInfo[];
  recent: StarlingEvent[];
  selectedTask?: string;
  onSelectTask(key: string): void;
  reducedMotion?: boolean;
  /**
   * True when the sky is off-screen (the shell keeps both centre views mounted for instant
   * switching). The flock should glide, not animate: no rAF loop, no cursor churn.
   * Additive in Wave 2 (Epic 40) at the dashboard's request (C1 handback, request 3).
   */
  paused?: boolean;
}

export interface DagViewProps {
  plan?: Plan;
  tasks: Record<string, TaskRun>;
  selectedTask?: string;
  onSelectTask(key: string): void;
}

export interface AgentDrawerProps {
  task?: TaskSpec;
  run?: TaskRun;
  events: AgentEvent[];
  verdicts: AuditVerdict[];
  diff?: DiffSummary;
  onClose(): void;
}

export interface MergeQueueProps {
  plan?: Plan;
  tasks: Record<string, TaskRun>;
  merges: MergeResult[];
  /** Selected task key, so the queue board can highlight the card the other views are showing. */
  selectedTask?: string;
  onSelectTask(key: string): void;
}

export interface MetricsPanelProps {
  metrics?: RunMetrics;
  history: { ts: number; metrics: RunMetrics }[];
  /** True when the metrics stream is still ticking (Epic 26's cost meter uses it). */
  live?: boolean;
}

export interface FlockPanelProps {
  nodes: NodeInfo[];
  join?: JoinInfo;
  tasks: Record<string, TaskRun>;
  /** Selecting a node's task opens the agent drawer (Epic 32). */
  onSelectTask?(key: string): void;
}

// features/sky → SkyView · features/dag → DagView · features/agents → AgentDrawer
// features/queue → MergeQueue · features/metrics → MetricsPanel · features/flock → FlockPanel

// ── Worker handback block: produced by worker prompts (E13), parsed by prompts.parseHandback,
//    shown in the UI. The last thing a worker prints:
//    <<<STARLING_HANDBACK
//    {"status":"complete","summary":"…","filesChanged":["…"],"testsAdded":["…"],"notes":"…"}
//    STARLING_HANDBACK>>>
export interface WorkerHandback {
  status: 'complete' | 'partial';
  summary: string;
  filesChanged: string[];
  testsAdded: string[];
  notes?: string;
}
