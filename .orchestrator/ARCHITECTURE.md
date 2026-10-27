# Starling — Architecture (Orchestrator-owned, source of truth)

Every epic prompt says "read this file first". Sections 6 and 7 are **LOCKED**. Build on them; don't relitigate. If you think a locked item is wrong, say so under *Open questions* in your handback. Don't change it.

---

## 1. Big picture

```
            ┌──────────── apps/cli ───────────┐      ┌────── apps/web (The Sky) ──────┐
 goal ───►  │ starling plan|run|replay|dash   │      │ Sky · DAG · Agents · Queue ·   │
            └───────────────┬─────────────────┘      │ Metrics      (React + Vite)    │
                            │ in-process              └───────────────▲───────────────┘
                            ▼                                         │ SSE + REST
            ┌──────────────────────── packages/engine ───────────────┴──────────────┐
            │ state machine: map → plan → dispatch(ready tasks) → audit → fix loop  │
            │   → merge queue → finish.   Talks ONLY to ports defined in core.      │
            └──┬──────┬────────┬─────────┬──────────┬─────────┬────────┬───────┬───┘
               │      │        │         │          │         │        │       │
            repomap planner prompts workspace    runner    auditor   merger  github(tracker)
               │      │                 (git       (opencode  │  (tests,    (merge-tree,
               └──────┴─────── llm ──┐  worktrees)  server+SDK)│   lane, LLM) integration br.)
                                     │                         │
                     DeepSeek V4.1 Flash (API)        Qwen 3.6 via Ollama (local)
                                     store (bun:sqlite + JSONL event log)  ◄── every event
```

**Process model in production:** one Starling process, the **hub** (CLI or server), runs the engine in-process. The engine never touches worktrees or opencode directly. It dispatches tasks to **ExecutionNodes**:

- **LocalNode** (in `packages/flock`) composes `Workspace` + `AgentRunner` on the hub machine. It starts/attaches **one** `opencode serve` and opens one session per task. Each session targets the task's worktree via the SDK's per-client `directory` (`x-opencode-directory` header).
- **RemoteNode** (in `packages/flock`) is an HTTP client for a **perch**: another machine running `starling perch` (`packages/perch`). A perch is the same LocalNode wrapped in the Perch HTTP API (§6).

```
   MacBook Pro (hub)                                  M2 Air (perch)            any laptop (perch)
 ┌─────────────────────────────┐   join / heartbeat  ┌──────────────────────┐   ┌──────────────┐
 │ engine ─► scheduler ─► LocalNode (worktrees+oc)│◄──────────────────│ perch HTTP :7778     │   │ perch …      │
 │                  └─► RemoteNode ────────────────────── task + bundle ─►│ LocalNode            │   └──────────────┘
 │ auditor · merger · store    │ ◄──── result bundle ─│ (worktrees+opencode) │
 │ server :7777 (SSE → web)    │ ◄──── AgentEvents ───│ [ollama: lendable]   │
 └─────────────────────────────┘                     └──────────────────────┘
```

**Repo transfer:** the hub serves `git bundle create - <ref>` of the integration branch. The perch clones/fetches it into a cache repo and makes a worktree. When the agent is done, the perch commits and returns `git bundle create - fromRef..branch`. The hub `git fetch`es that bundle into the real repo as the task branch. Audit and merge always happen on the hub, so the hub's repo stays the single source of truth.

**Discovery:** perches advertise `_starling._tcp` over mDNS (`bonjour-service`) and the hub lists them; or the perch is started with `--hub http://<ip>:7777 --code <join-code>`. Every hub↔perch call carries the `x-flock-token` header (the join code). Heartbeats run every 3 s. A perch missing for 15 s is `offline` and its running tasks are rescheduled.

**Scheduling:** pick the online node with the most free session slots (`maxSessions - activeSessions`). Tie-break by lowest recent latency, then prefer the hub. Per-node `maxSessions` comes from the perch's own config (default: MBP 8, Air 5 in demo).

The server app wraps the same engine and exposes REST + SSE.

## 2. Model routing (the open-weight story)

| Role | Default model | Where | Why |
|---|---|---|---|
| `planner` | DeepSeek V4.1 Flash | API (OpenAI-compatible) | Hard reasoning, long context (1M), structured JSON |
| `worker` | DeepSeek V4.1 Flash | inside opencode sessions | Strong agentic coding; opencode supports it natively |
| `resolver` | DeepSeek V4.1 Flash | inside opencode | Merge-conflict fixing is real coding |
| `auditor` | Qwen 3.6 35B-A3B (Q4) | Ollama, local | High-volume judging, zero marginal cost, private |
| `summarizer` | same local model (or a smaller one) | Ollama | Repo-map file summaries, cached |
| `writer` | same local model | Ollama | PR bodies, commit messages, run summaries |

All routes are config. `--fully-open` maps every role to local models, workers included, via opencode's Ollama provider. Exact Ollama tags are decided in E02/E28 after benchmarking on Moksh's M5 Pro (32 GB). Until then, use the placeholder `qwen3.6:35b-a3b`.

## 3. Repo layout (LOCKED — lanes are built on it)

```
/AGENTS.md                      standing rules for every coding agent (orchestrator-owned)
/opencode.json                  dev-time opencode config (orchestrator-owned)
/.orchestrator/                 PRD, ARCHITECTURE, ROADMAP, PROCESS, prompts/, handbacks/, bin/
/package.json /bun.lock /tsconfig.base.json /biome.json /.gitignore /README.md /LICENSE
/starling.config.example.yaml
/packages/core        contracts (types + zod), event bus, config, ids, errors, testing/ mocks
/packages/llm         model router + providers + structured output + cost meter
/packages/repomap     repo scanner → RepoMap
/packages/planner     goal + RepoMap → Plan (DAG + lanes), validator, auto-repair
/packages/prompts     PromptCompiler: worker / fixer / resolver prompts
/packages/workspace   git worktrees, diffs, conflict prediction
/packages/runner      AgentRunner: opencode (real) + replay/mock
/packages/auditor     Auditor: commands + lane check + LLM verdict
/packages/merger      Merger: merge queue onto integration branch
/packages/github      Tracker: GitHub issues/PRs via gh CLI (+ NoopTracker)
/packages/store       Store: bun:sqlite + JSONL event log, record/replay
/packages/engine      Engine: orchestration state machine
/packages/flock       ExecutionNode impls (LocalNode, RemoteNode), node registry, discovery, scheduler, bundle import
/packages/perch       perch daemon: Perch HTTP API over a LocalNode, mDNS advertise, hub registration
/apps/cli             `starling` binary
/apps/server          Hono server: REST + SSE, serves web build
/apps/web             React dashboard; features/ subfolders = separate lanes
/skills/starling      Agent Skill (SKILL.md + scripts)
/integrations/opencode  opencode command/plugin
/examples/sky-todo    demo target app (copied to a temp git repo at run time)
/fixtures             recorded event streams, sample plans/repomaps (shared test data)
/tools/local-models   Ollama setup + local-vs-API benchmark
/evals                planner / auditor quality evals
/docs                 docs/epic-NN-slug.md ONLY (one per epic)
```

Package names are `@starling/<dir>` (e.g. `@starling/core`, `@starling/web`).

## 4. Runtime flow (engine state machine)

1. `goal.created` → RepoMapper.map → `repomap.ready`
2. Planner.plan → validate (DAG acyclic, lanes disjoint for tasks that can run concurrently, every task has DoD) → auto-repair up to 2× → `plan.created`. `--dry-run` stops here.
3. Tracker.syncPlan (no-op unless GitHub mode).
4. Loop until all tasks are terminal:
   - Tasks whose `dependsOn` are all `merged` become `ready`. Dispatch up to `maxParallel` (summed across nodes): Scheduler.pick(node) → PromptCompiler.worker → `node.startTask` (branch `starling/<runShort>/<taskKey>` from the integration branch) → `running`.
   - On session idle → `node.collect` (a remote node's bundle is imported into the hub repo as the task branch) → `auditing` → Auditor.audit against the hub-side branch. If pass → Merger.merge → `merging`. If fail and attempts < `maxAttempts` → PromptCompiler.fixer → `node.sendPrompt` (same session, same node) → `fixing`. Otherwise → `failed`.
   - `node.left` while a task is running/fixing → the task goes back to `ready` (attempts unchanged) and is rescheduled.
   - Merger results: `merged` → Tracker update, Workspace.remove; `conflict` → spawn resolver (stretch) or `failed`; `tests-failed` → back to fixer.
5. `run.finished` with summary (writer role). Integration branch `starling/<runShort>/integration` is the deliverable. GitHub mode opens a PR from it to base.

All transitions publish `StarlingEvent`s on the EventBus. The Store persists all of them. The server streams them. Replay re-publishes them from a JSONL file with original timing (speed factor configurable).

## 5. Config (`starling.config.yaml`, all optional, zod-validated)

```yaml
maxParallel: 8
maxAttempts: 3
baseBranch: main
integrationBranch: auto              # starling/<runShort>/integration
worktreeRoot: ../.starling-worktrees
testCommand: auto                    # detected by repomap, overridable
lintCommand: auto
opencode: { mode: spawn, port: 4096, url: null }      # spawn | attach
models:
  planner:    { provider: deepseek, model: deepseek-v4.1-flash }
  worker:     { provider: deepseek, model: deepseek-v4.1-flash }   # opencode providerID/modelID
  resolver:   { provider: deepseek, model: deepseek-v4.1-flash }
  auditor:    { provider: ollama,   model: qwen3.6:35b-a3b }
  summarizer: { provider: ollama,   model: qwen3.6:35b-a3b }
  writer:     { provider: ollama,   model: qwen3.6:35b-a3b }
providers:
  deepseek: { baseUrl: https://api.deepseek.com/v1, apiKeyEnv: DEEPSEEK_API_KEY }
  ollama:   { baseUrl: http://127.0.0.1:11434/v1 }
github: { enabled: false, repo: null }
budget: { maxUsd: 5 }
server: { port: 7777 }
flock:
  enabled: true
  hubMaxSessions: 8          # LocalNode capacity on the hub
  mdns: true
  heartbeatMs: 3000
  offlineAfterMs: 15000
perch:                       # used by `starling perch`
  port: 7778
  maxSessions: 5
  name: auto                 # hostname
  cacheDir: ~/.starling/perch
  lendModels: true           # stretch: expose local ollama to hub
```

## 6. Contracts — LOCKED (`packages/core/src/contracts.ts`, implemented verbatim in E00)

Every type has a matching zod schema named `<Type>Schema` exported alongside it. Types are inferred from the schemas (`z.infer`) so the two can't drift. IDs are ULIDs (string). Timestamps are epoch ms (number).

```ts
// ── models ──────────────────────────────────────────────
export type ModelRole = 'planner' | 'worker' | 'resolver' | 'auditor' | 'summarizer' | 'writer';
export interface ModelRef { provider: string; model: string }       // e.g. {provider:'deepseek', model:'deepseek-v4.1-flash'}
export interface TokenUsage { input: number; output: number; cached: number }

// ── goal / plan ─────────────────────────────────────────
export interface Goal { id: string; text: string; repoPath: string; baseBranch: string; createdAt: number; constraints: string[] }
export interface Lane { owns: string[]; reads: string[] }           // globs relative to repo root
export interface TaskSpec {
  key: string;                 // kebab, unique in plan, e.g. 't03-csv-export'
  title: string;
  goal: string;
  deliverables: string[];
  outOfScope: string[];
  definitionOfDone: string[];  // literal, checkable steps
  dependsOn: string[];         // task keys
  lane: Lane;
  estimateMin: number;
}
export interface Plan {
  id: string; goalId: string; summary: string;
  tasks: TaskSpec[];
  lockedDecisions: string[];   // repo-wide facts every worker prompt restates
  model: ModelRef; createdAt: number;
}
export interface PlanIssue { severity: 'error' | 'warn'; code: 'cycle' | 'lane-overlap' | 'missing-dep' | 'empty-dod' | 'empty-lane' | 'other'; message: string; taskKeys: string[] }

// ── repo map ────────────────────────────────────────────
export interface RepoFile { path: string; bytes: number; lang: string; symbols: string[]; summary?: string }
export interface RepoMap {
  root: string; tree: string; files: RepoFile[];
  languages: Record<string, number>;
  testCommand?: string; lintCommand?: string;
  tokenEstimate: number; createdAt: number;
}

// ── runs ────────────────────────────────────────────────
export type TaskStatus = 'pending' | 'ready' | 'running' | 'auditing' | 'fixing' | 'merging'
                       | 'merged' | 'failed' | 'conflict' | 'cancelled';
export interface TaskRun {
  runId: string; taskKey: string; status: TaskStatus;
  branch?: string; worktreePath?: string; sessionId?: string;
  attempts: number; startedAt?: number; finishedAt?: number;
  usage: TokenUsage; costUsd: number;
  issueNumber?: number; prUrl?: string; lastVerdict?: AuditVerdict;
  nodeId?: string;             // which ExecutionNode ran it ('hub' for LocalNode on the hub)
}

// ── flock (distributed execution) ───────────────────────
export interface NodeInfo {
  id: string; name: string;                    // name e.g. "Moksh's MacBook Pro"
  kind: 'local' | 'remote'; url?: string;      // remote: perch base URL
  platform: string; arch: string; cpuCores: number; memGb: number;
  maxSessions: number; activeSessions: number;
  localModels: string[];                       // ollama models the node can lend
  status: 'online' | 'busy' | 'offline';
  lastSeen: number; latencyMs?: number;
}
export interface TaskHandle { nodeId: string; runId: string; taskKey: string; branch: string; sessionId: string }
export interface StartTaskOptions {
  runId: string; taskKey: string; title: string;
  repo: { kind: 'local'; path: string } | { kind: 'bundle'; url: string; token: string };
  fromRef: string; branch: string; prompt: string; model: ModelRef;
}
export interface TaskResult { commit: string; diff: DiffSummary; changedFiles: string[]; bundlePath?: string }  // bundlePath: hub-local file once fetched
export interface Run {
  id: string; goal: Goal; plan?: Plan; tasks: Record<string, TaskRun>;
  status: 'mapping' | 'planning' | 'planned' | 'running' | 'finished' | 'failed' | 'cancelled';
  integrationBranch?: string; startedAt: number; finishedAt?: number; metrics: RunMetrics;
}
export interface RunMetrics {
  agentsActive: number; tasksMerged: number; tasksFailed: number;
  apiUsage: TokenUsage; localUsage: TokenUsage;
  apiCostUsd: number; localCallCount: number; estSavedUsd: number; elapsedMs: number;
}

// ── agent events (normalized from opencode SSE) ────────
export type AgentEventKind = 'session.started' | 'text' | 'tool.call' | 'tool.result'
                           | 'file.edited' | 'usage' | 'session.idle' | 'session.error';
export interface AgentEvent { runId: string; taskKey: string; sessionId: string; ts: number; kind: AgentEventKind; data: Record<string, unknown> }

// ── audit / merge ───────────────────────────────────────
export interface DiffSummary { files: { path: string; added: number; removed: number }[]; patch: string; truncated: boolean }
export interface AuditCheck { name: string; ok: boolean; detail: string }
export interface AuditVerdict {
  taskKey: string; attempt: number; pass: boolean;
  checks: AuditCheck[]; laneViolations: string[];
  summary: string; fixInstructions?: string; model: ModelRef; ts: number;
}
export interface MergeResult { taskKey: string; status: 'merged' | 'conflict' | 'tests-failed' | 'skipped'; conflictedFiles: string[]; commit?: string; detail: string; ts: number }

// ── the event bus envelope (everything the UI sees) ────
export type StarlingEvent =
  | { type: 'run.created';    runId: string; ts: number; payload: { run: Run } }
  | { type: 'repomap.ready';  runId: string; ts: number; payload: { files: number; tokenEstimate: number } }
  | { type: 'plan.created';   runId: string; ts: number; payload: { plan: Plan; issues: PlanIssue[] } }
  | { type: 'task.status';    runId: string; ts: number; payload: { taskKey: string; from: TaskStatus; to: TaskStatus; run: TaskRun } }
  | { type: 'agent.event';    runId: string; ts: number; payload: AgentEvent }
  | { type: 'audit.verdict';  runId: string; ts: number; payload: AuditVerdict }
  | { type: 'merge.result';   runId: string; ts: number; payload: MergeResult }
  | { type: 'metrics';        runId: string; ts: number; payload: RunMetrics }
  | { type: 'log';            runId: string; ts: number; payload: { level: 'debug' | 'info' | 'warn' | 'error'; msg: string; taskKey?: string } }
  | { type: 'node.joined';    runId: string; ts: number; payload: { node: NodeInfo } }     // runId '*' when not run-scoped
  | { type: 'node.left';      runId: string; ts: number; payload: { nodeId: string; reason: string } }
  | { type: 'node.stats';     runId: string; ts: number; payload: { node: NodeInfo } }
  | { type: 'task.migrated';  runId: string; ts: number; payload: { taskKey: string; fromNode: string; toNode: string; reason: string } }
  | { type: 'run.finished';   runId: string; ts: number; payload: { run: Run; summary: string } };
```

### Ports (`packages/core/src/ports.ts`), the only coupling between packages

```ts
export interface LLMRequest { role: ModelRole; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; maxTokens?: number; temperature?: number }
export interface LLMResponse<T = unknown> { text: string; parsed?: T; usage: TokenUsage; model: ModelRef; costUsd: number; local: boolean }
export interface LLM {
  complete(req: LLMRequest): Promise<LLMResponse>;
  completeJson<T>(req: LLMRequest, schema: import('zod').ZodType<T>): Promise<LLMResponse<T>>;   // validates + repairs (≤2 retries)
}
export interface RepoMapper { map(repoPath: string, opts?: { summarize?: boolean; maxFiles?: number }): Promise<RepoMap> }
export interface Planner { plan(goal: Goal, map: RepoMap): Promise<{ plan: Plan; issues: PlanIssue[] }>; validate(plan: Plan): PlanIssue[] }
export interface PromptContext { goal: Goal; plan: Plan; map: RepoMap; task: TaskSpec; branch: string; testCommand?: string }
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
  commitAll(worktreePath: string, message: string): Promise<string | undefined>;  // returns sha or undefined if clean
  remove(worktreePath: string): Promise<void>;
}
export interface AgentRunner {
  start(opts: { runId: string; taskKey: string; dir: string; prompt: string; model: ModelRef; title: string }): Promise<{ sessionId: string }>;
  send(sessionId: string, prompt: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
  onEvent(fn: (e: AgentEvent) => void): () => void;      // returns unsubscribe
  close(): Promise<void>;
}
export interface AuditInput { ctx: PromptContext; run: TaskRun; diff: DiffSummary; changedFiles: string[]; attempt: number }
export interface Auditor { audit(input: AuditInput): Promise<AuditVerdict> }
export interface Merger {
  merge(repo: string, integrationBranch: string, run: TaskRun, opts: { testCommand?: string }): Promise<MergeResult>;
}
export interface Tracker {
  syncPlan(run: Run): Promise<Record<string, number>>;          // taskKey → issue number
  openTaskPR(run: Run, task: TaskRun, body: string): Promise<string | undefined>;
  onMerged(run: Run, task: TaskRun): Promise<void>;
  openFinalPR(run: Run, body: string): Promise<string | undefined>;
}
export interface Store {
  saveRun(run: Run): void; getRun(id: string): Run | undefined; listRuns(): Run[];
  appendEvent(e: StarlingEvent): void; events(runId: string, sinceTs?: number): StarlingEvent[];
  exportJsonl(runId: string, path: string): void;
}
export interface EventBus { publish(e: StarlingEvent): void; subscribe(fn: (e: StarlingEvent) => void): () => void }

// The engine's ONLY way to run an agent. LocalNode = Workspace + AgentRunner; RemoteNode = Perch HTTP client.
export interface ExecutionNode {
  readonly id: string;
  info(): Promise<NodeInfo>;
  startTask(opts: StartTaskOptions): Promise<TaskHandle>;
  sendPrompt(h: TaskHandle, prompt: string): Promise<void>;
  abort(h: TaskHandle): Promise<void>;
  collect(h: TaskHandle, hubRepo: string, baseRef: string): Promise<TaskResult>;  // after return, branch h.branch exists in hubRepo
  cleanup(h: TaskHandle): Promise<void>;
  onEvent(fn: (e: AgentEvent) => void): () => void;
}
export interface NodeRegistry {
  list(): NodeInfo[]; get(id: string): ExecutionNode | undefined;
  onChange(fn: (e: { type: 'joined' | 'left' | 'stats'; node: NodeInfo }) => void): () => void;
}
export interface Scheduler { pick(nodes: NodeInfo[], task: TaskSpec): string | undefined }  // returns nodeId or undefined if no capacity
export interface Clock { now(): number }
```

`packages/core/src/testing/` ships **mocks for every port** (`MockLLM` with scripted responses, `MockRunner` that emits fixture events, `MockWorkspace`, `MockAuditor`, `MockMerger`, `MockNode` (an ExecutionNode with scripted events; it can simulate dying mid-task), `MockRegistry`, `NoopTracker`, `MemoryStore`, `FakeClock`). Every Wave 1 epic tests against these and never imports a sibling package's internals.

### Server API (LOCKED, `apps/server`)

| Method | Path | Body / result |
|---|---|---|
| GET | `/api/health` | `{ ok: true, version }` |
| GET | `/api/runs` | `Run[]` (most recent first) |
| GET | `/api/runs/:id` | `Run` |
| POST | `/api/runs` | `{ goal: string, repoPath: string, dryRun?: boolean, maxParallel?: number }` → `{ runId }` |
| POST | `/api/runs/:id/cancel` | → `{ ok }` |
| POST | `/api/runs/:id/tasks/:key/abort` | → `{ ok }` |
| GET | `/api/runs/:id/events?since=ts` | **SSE**. Each message `data:` is one `StarlingEvent` JSON. Backlog first, then live. |
| POST | `/api/replay` | `{ path: string, speed?: number }` → `{ runId }` (replays a JSONL file as a new run) |
| GET | `/api/nodes` | `NodeInfo[]` (hub first) |
| GET | `/api/flock/join` | `{ code, hubUrl, command }` (the dashboard shows this as text + QR) |
| POST | `/api/flock/register` | header `x-flock-token`; `{ url: string, info: NodeInfo }` → `{ nodeId }` (perch → hub) |
| POST | `/api/flock/heartbeat` | header `x-flock-token`; `{ nodeId, info: NodeInfo }` → `{ ok }` |
| GET | `/api/flock/bundle?ref=<ref>` | header `x-flock-token`; `application/octet-stream` git bundle of `ref` from the hub repo of the active run |
| GET | `/api/events` | SSE of **all** events (run-scoped plus node.*). Same format as the per-run stream |

Default port **7777**.

### Perch API (LOCKED, `packages/perch`, default port **7778**, every route requires `x-flock-token`)

| Method | Path | Body / result |
|---|---|---|
| GET | `/perch/info` | `NodeInfo` |
| POST | `/perch/tasks` | `StartTaskOptions` (repo is always `{kind:'bundle'}`) → `TaskHandle` |
| POST | `/perch/tasks/:runId/:key/prompt` | `{ prompt }` → `{ ok }` |
| POST | `/perch/tasks/:runId/:key/abort` | → `{ ok }` |
| POST | `/perch/tasks/:runId/:key/collect` | `{ baseRef }` → `{ commit, diff, changedFiles }` (commits all work on the perch first) |
| GET | `/perch/tasks/:runId/:key/bundle?base=<ref>` | `application/octet-stream`: `git bundle create - base..branch` |
| DELETE | `/perch/tasks/:runId/:key` | cleanup worktree → `{ ok }` |
| GET | `/perch/events` | SSE; each `data:` is one `AgentEvent` | The web dev server proxies `/api` → 7777. In prod, the server serves `apps/web/dist`.

### CLI surface (LOCKED, `apps/cli`, binary `starling`)

`starling plan "<goal>" [--repo .] [--json]` · `starling run "<goal>" [--repo .] [--max-parallel 8] [--github] [--fully-open] [--dry-run] [--record out.jsonl] [--no-dash]` · `starling replay <file.jsonl> [--speed 4]` · `starling dash [--port 7777]` · `starling perch [--hub http://ip:7777] [--code XXXX-XXXX] [--port 7778] [--max-sessions 5] [--name "M2 Air"]` · `starling flock` (list nodes + print the join command) · `starling status [runId]` · `starling doctor` (checks bun, git, opencode, ollama, keys) · `starling init` (writes starling.config.yaml).

## 7. Tech decisions LOCKED

- **L1** Runtime **Bun ≥ 1.3** (pin the exact version found at E00 in `package.json#packageManager` and `.bun-version`). TypeScript **strict**, ESM only, `"moduleResolution": "bundler"`.
- **L2** **Bun workspaces**: `packages/*`, `apps/*`. Internal deps use `"workspace:*"`. Packages export TS source directly (`"exports": {".": "./src/index.ts"}`), so no build step between packages.
- **L3** Tests: **`bun test`**, colocated `*.test.ts` under each package's `src/` or `test/`. Root `bun run test` runs every workspace test and excludes `examples/` and `fixtures/` (`examples/sky-todo` is a separate project with its own tests). No network in unit tests. Real-API / real-opencode tests are tagged with the filename suffix `*.live.test.ts` and are skipped unless `STARLING_LIVE=1`.
- **L4** Lint/format: **Biome** (root `biome.json`). `bun run check` = biome check + `tsc --noEmit -p` for each package (or a root project-references build).
- **L5** Validation: **zod v4**. All contracts are zod-first (sec. 6).
- **L6** IDs: ULID (`ulid` package), wrapped in `core/ids.ts`.
- **L7** LLM access: **OpenAI-compatible HTTP** through the `openai` npm SDK, pointed at DeepSeek and Ollama base URLs. No LangChain or other frameworks.
- **L8** opencode access: **`@opencode-ai/sdk`** against one `opencode serve`; per-task client with `directory` set to the worktree.
- **L9** Persistence: **`bun:sqlite`** (file `.starling/starling.db` in the target repo's parent, or `~/.starling/`), plus a JSONL event log per run.
- **L10** Server: **Hono** on Bun. SSE via Hono's `streamSSE`.
- **L11** Web: **React 19 + Vite + Tailwind v4 + TypeScript**. State: **zustand**. DAG: **@xyflow/react** + **dagre**. Sky: raw **Canvas 2D** boids (no three.js). Icons: lucide-react. No component library beyond small handwritten components.
- **L12** CLI: plain Bun script with **commander** (args) + **picocolors** (output). No ink.
- **L13** Git: shell out to the `git` CLI via `Bun.spawn` (`core/exec.ts` helper). No libgit2 / isomorphic-git.
- **L14** GitHub: shell out to the **`gh` CLI**. No Octokit.
- **L15** Local models: **Ollama** OpenAI-compatible endpoint `http://127.0.0.1:11434/v1`.
- **L16** License **MIT**. Public repo, `hacktoberfest` topic.
- **L17** Dev-time agents: opencode + DeepSeek V4.1 Flash. Workflow = issues + branches + worktrees + PRs (see PROCESS.md). Not trunk-based. Two dev machines: MacBook Pro M5 Pro 32 GB (primary, ~20 sessions) and MacBook Air M2 (~10–15 sessions).
- **L18** Flock transport: plain HTTP + SSE between hub and perches (Hono on both sides). Repo transfer via **git bundles** only (no shared filesystem, no SSH, no GitHub round-trip). Auth: shared join code in `x-flock-token`. LAN-only, so no TLS.
- **L19** Discovery: **`bonjour-service`** mDNS (`_starling._tcp`) plus the manual `--hub/--code` join, which must always work.
- **L20** Engine ↔ execution only through `ExecutionNode`. Audit and merge only ever run on the hub's repo.

- **L21** (from Epic 00) Toolchain pinned at root: **Bun 1.4.4, TypeScript 5.9.3, zod 4.6.7, Biome 2.6.3**. Root `bun run check` = Biome + a per-workspace `tsc --noEmit -p` loop. Never change root config in a feature epic.
- **L22** (from Epic 00) Third-party deps are pre-installed per package (see `docs/epic-00-foundation.md`). Feature epics may add deps **only to their own package.json**, pinned exact. Web feature epics may add a dep to `apps/web/package.json` (add-only, alphabetical). The integrator resolves `package.json`/`bun.lock` merges.
- **L23** (lesson from Epic 02) **No local models during build waves.** Never run `ollama pull/run`, and never call a real LLM, a real opencode server prompt, or GitHub from tests. In-process `Bun.serve({ port: 0 })` fakes are fine. `*.live.test.ts` files may be written but are **not run** in Wave 1. (A 27B local model plus ~20 agents put a 32 GB Mac at 4% free RAM.)
- **L24** (from Epic 02) Measured local auditor candidate: **`qwen3.8:27b-mlx`** on Ollama (~18–19 tok/s warm on M5 Pro, correctly failed a no-test diff). The final pick is Epic 28's job.
- **L25** (from the dev setup) Moksh's opencode is a **newer CLI** (a background service, `serve` = "v2 API and web server", no `--model` flag on the TUI). Its LLM access is through the **OpenCode Go** provider (`opencode-go/deepseek-v4.1-flash`). Starling must work when the user has **no direct DeepSeek API key**, so the LLM router supports an `opencode` provider that routes completions through the user's opencode server (see §8).

- **L26** (C1) Root `bun run test` runs `apps/web` in its own `bun test` process (happy-dom replaces global `fetch`). Clients take an explicit `fetch` in tests.
- **L27** (C1) Biome: the Markdown formatter is off and the CSS parser accepts Tailwind directives.
- **L28** (C1) Core additions: error codes `LLM_BAD_JSON | GIT_TOO_OLD | GH_AUTH | GH_REPO | GH_COMMAND | GH_MISSING | NOT_WIRED | NODE_AUTH`; `AuditCheck.durationMs?`; `AuditVerdict.dod?: {item, met, evidence?}[]`; `NodeRegistry` event `reason?`; LLM `opts?: {signal, timeoutMs}`; `Merger.preflight?` + `MergePreflight`; `BundleOps` + mDNS ports; §8 handshake types live in `packages/core/src/handshake.ts` (old mirrors re-export them); `@starling/core/browser` is the browser-safe entry. `PRICING` uses DeepSeek's published *peak* rates.
- **L29** (Wave 2) Real model calls go through the `opencode` LLM profile only (Moksh's opencode-go provider; no DeepSeek API key). E2E runs use small goals, one real run per session at a time.
- **L30** (Wave 2) `packages/core` is owned only by Epic 40 (additive) and `packages/engine` only by Epic 49. Others file FIX REQUESTS.
- **L31** (Wave 2) Local-model memory rails: load Ollama models only when ≤ 3 opencode processes are running and ≥ 22 GB is free; unload after; never pull > 20 GB during a wave.

## 8. Wave 1 handshake interfaces (LOCKED for Wave 1)

These sit between packages being built **in parallel**. Each consuming or implementing epic declares the interface **locally** in `src/handshake.ts`, with the header comment `// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.`, copied exactly as written here. Never import a sibling Wave 1 package. At C1 the integrator moves these into core and deletes the mirrors.

```ts
import type { Run, NodeInfo, NodeRegistry, Plan, TaskRun, TaskSpec, AgentEvent, AuditVerdict,
  MergeResult, RunMetrics, DiffSummary, StarlingEvent } from '@starling/core';

// ── Engine API: implemented by packages/engine (E20); consumed by apps/server (E21) + apps/cli (E22)
export interface StartRunInput { goal: string; repoPath: string; dryRun?: boolean; maxParallel?: number; baseBranch?: string }
export interface EngineApi {
  start(input: StartRunInput): Promise<{ runId: string }>;      // resolves once the run is created; work continues async
  cancel(runId: string): Promise<void>;
  abortTask(runId: string, taskKey: string): Promise<void>;
  getRun(runId: string): Run | undefined;
  listRuns(): Run[];                                            // most recent first
  waitForFinish(runId: string): Promise<Run>;                   // CLI uses this for `starling run`
}

// ── Flock hub: implemented by packages/flock (E30); consumed by apps/server (E21), engine (E20), cli (E22)
export interface JoinInfo { code: string; hubUrl: string; command: string }   // command: `starling perch --hub <url> --code <code>`
export interface FlockHub {
  registry: NodeRegistry;                                       // includes the hub's own LocalNode with id 'hub'
  joinInfo(): JoinInfo;
  verifyToken(token: string | undefined): boolean;
  register(input: { url: string; info: NodeInfo }): Promise<{ nodeId: string }>;
  heartbeat(input: { nodeId: string; info: NodeInfo }): void;
  bundle(ref: string): Promise<{ path: string }>;               // a git bundle file of `ref` from the active repo
  setActiveRepo(repoPath: string): void;
  close(): Promise<void>;
}

// ── Bundle URL: how the engine (E20) tells a RemoteNode where to fetch the repo. Server path is §6 /api/flock/bundle
export type BundleUrlFor = (ref: string) => { url: string; token: string };

// ── Web feature components: each feature epic exports exactly these from its feature folder's index.ts.
//    They take plain props (core types only) and NEVER read the global store. The shell (E23) wires store → props.
export interface SkyViewProps { run?: Run; nodes: NodeInfo[]; recent: StarlingEvent[]; selectedTask?: string;
  onSelectTask(key: string): void; reducedMotion?: boolean }
export interface DagViewProps { plan?: Plan; tasks: Record<string, TaskRun>; selectedTask?: string; onSelectTask(key: string): void }
export interface AgentDrawerProps { task?: TaskSpec; run?: TaskRun; events: AgentEvent[]; verdicts: AuditVerdict[];
  diff?: DiffSummary; onClose(): void }
export interface MergeQueueProps { plan?: Plan; tasks: Record<string, TaskRun>; merges: MergeResult[]; onSelectTask(key: string): void }
export interface MetricsPanelProps { metrics?: RunMetrics; history: { ts: number; metrics: RunMetrics }[] }
export interface FlockPanelProps { nodes: NodeInfo[]; join?: JoinInfo; tasks: Record<string, TaskRun> }
// features/sky → SkyView · features/dag → DagView · features/agents → AgentDrawer
// features/queue → MergeQueue · features/metrics → MetricsPanel · features/flock → FlockPanel

// ── Worker handback block: produced by worker prompts (E13), parsed by prompts.parseHandback, shown in the UI
//    The last thing a worker prints:
//    <<<STARLING_HANDBACK
//    {"status":"complete","summary":"…","filesChanged":["…"],"testsAdded":["…"],"notes":"…"}
//    STARLING_HANDBACK>>>
export interface WorkerHandback { status: 'complete' | 'partial'; summary: string; filesChanged: string[]; testsAdded: string[]; notes?: string }

// ── LLM provider kinds (E10): 'openai-compatible' (DeepSeek API, Ollama, OpenRouter…) and 'opencode'
//    (a completion = a throwaway session on the user's opencode server, using whatever provider opencode is logged into).
```

*(The list grows as epics land. The Orchestrator appends confirmed decisions here and restates them in the next wave's prompts.)*
