// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
/**
 * Wave 1 handshake interfaces (ARCHITECTURE §8, LOCKED for Wave 1).
 *
 * The CLI consumes these contracts but must not import a sibling Wave 1 package while it is being
 * built in parallel. At checkpoint C1 the integrator moves this file into `@starling/core` and every
 * mirror is deleted. Keep the declarations byte-for-byte identical to the architecture document.
 */
import type {
  AgentEvent,
  AuditVerdict,
  DiffSummary,
  MergeResult,
  NodeInfo,
  NodeRegistry,
  Plan,
  Run,
  RunMetrics,
  StarlingEvent,
  TaskRun,
  TaskSpec,
} from '@starling/core';

// ── Engine API: implemented by packages/engine (E20); consumed by apps/server (E21) + apps/cli (E22)
export interface StartRunInput {
  goal: string;
  repoPath: string;
  dryRun?: boolean;
  maxParallel?: number;
  baseBranch?: string;
}
export interface EngineApi {
  start(input: StartRunInput): Promise<{ runId: string }>; // resolves once the run is created; work continues async
  cancel(runId: string): Promise<void>;
  abortTask(runId: string, taskKey: string): Promise<void>;
  getRun(runId: string): Run | undefined;
  listRuns(): Run[]; // most recent first
  waitForFinish(runId: string): Promise<Run>; // CLI uses this for `starling run`
}

// ── Flock hub: implemented by packages/flock (E30); consumed by apps/server (E21), engine (E20), cli (E22)
export interface JoinInfo {
  code: string;
  hubUrl: string;
  command: string;
} // command: `starling perch --hub <url> --code <code>`
export interface FlockHub {
  registry: NodeRegistry; // includes the hub's own LocalNode with id 'hub'
  joinInfo(): JoinInfo;
  verifyToken(token: string | undefined): boolean;
  register(input: { url: string; info: NodeInfo }): Promise<{ nodeId: string }>;
  heartbeat(input: { nodeId: string; info: NodeInfo }): void;
  bundle(ref: string): Promise<{ path: string }>; // a git bundle file of `ref` from the active repo
  setActiveRepo(repoPath: string): void;
  close(): Promise<void>;
}

// ── Bundle URL: how the engine (E20) tells a RemoteNode where to fetch the repo. Server path is §6 /api/flock/bundle
export type BundleUrlFor = (ref: string) => { url: string; token: string };

// ── Web feature components: each feature epic exports exactly these from its feature folder's index.ts.
//    They take plain props (core types only) and NEVER read the global store. The shell (E23) wires store → props.
export interface SkyViewProps {
  run?: Run;
  nodes: NodeInfo[];
  recent: StarlingEvent[];
  selectedTask?: string;
  onSelectTask(key: string): void;
  reducedMotion?: boolean;
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
  onSelectTask(key: string): void;
}
export interface MetricsPanelProps {
  metrics?: RunMetrics;
  history: { ts: number; metrics: RunMetrics }[];
}
export interface FlockPanelProps {
  nodes: NodeInfo[];
  join?: JoinInfo;
  tasks: Record<string, TaskRun>;
}
// features/sky → SkyView · features/dag → DagView · features/agents → AgentDrawer
// features/queue → MergeQueue · features/metrics → MetricsPanel · features/flock → FlockPanel

// ── Worker handback block: produced by worker prompts (E13), parsed by prompts.parseHandback, shown in the UI
//    The last thing a worker prints:
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

// ── LLM provider kinds (E10): 'openai-compatible' (DeepSeek API, Ollama, OpenRouter…) and 'opencode'
//    (a completion = a throwaway session on the user's opencode server, using whatever provider opencode is logged into).
