/**
 * Generate `fixtures/runs/sky-todo-launch-day.jsonl` — a synthetic but realistic recorded run.
 *
 * It is the demo dataset for the dashboard until a real engine run exists, so it must exercise every
 * event the Sky renders: plan, parallel tasks, agent streams, an audit failure + fix, merges in DAG
 * order, metrics ticks, and the flock story (a perch joins, receives work, drops mid-task, and the
 * task migrates back to the hub).
 *
 * Regenerate with:
 *   bun fixtures/scripts/generate-launch-day.ts
 *
 * Every event is validated against `StarlingEventSchema` before it is written; a bad event fails
 * the script instead of shipping a broken fixture.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentEventKind,
  AuditVerdict,
  Goal,
  MergeResult,
  NodeInfo,
  Plan,
  Run,
  StarlingEvent,
  TaskRun,
  TaskStatus,
  TokenUsage,
} from '../../packages/core/src/index.ts';
import { StarlingEventSchema, usageCostUsd } from '../../packages/core/src/index.ts';

const ROOT = join(import.meta.dir, '../..');
const BASE_TS = 1_731_000_000_000;
const RUN_ID = '01jd2k7m3p4q5r6s7t8v9w0x1y';
const INTEGRATION_BRANCH = `starling/${RUN_ID.slice(-6)}/integration`;
const API_MODEL = 'deepseek-v4.1-flash';
const LOCAL_MODEL = 'qwen3.6:35b-a3b';
const API_MODEL_REF = { provider: 'deepseek', model: API_MODEL };
const LOCAL_MODEL_REF = { provider: 'ollama', model: LOCAL_MODEL };

const plan = JSON.parse(readFileSync(join(ROOT, 'fixtures/plans/sky-todo-launch-day.json'), 'utf8')) as Plan;
const goal: Goal = {
  id: plan.goalId,
  text: 'Add dark mode with a toggle, live search filtering, CSV export, keyboard shortcuts (n = new, / = search, ? = help), due-date badges, and fix the overdue-calculation and date-sorting bugs in src/lib/dates.ts.',
  repoPath: 'examples/sky-todo',
  baseBranch: 'main',
  createdAt: BASE_TS,
  constraints: ['Do not add runtime dependencies', 'Keep the bundle vanilla TypeScript'],
};

const at = (sec: number): number => BASE_TS + Math.round(sec * 1000);

const events: StarlingEvent[] = [];
function push(tsSec: number, event: StarlingEvent): void {
  events.push(event);
}

// ── run state ───────────────────────────────────────────────────────────────────────────────────
const tasks: Record<string, TaskRun> = {};
for (const task of plan.tasks) {
  tasks[task.key] = {
    runId: RUN_ID,
    taskKey: task.key,
    status: 'pending',
    attempts: 0,
    usage: { input: 0, output: 0, cached: 0 },
    costUsd: 0,
  };
}

const statusAt: Array<{ tsMs: number; key: string; status: TaskStatus }> = [];
const usageLog: Array<{ tsMs: number; bucket: 'api' | 'local'; usage: TokenUsage }> = [];
let localCalls = 0;

function snapshot(key: string): TaskRun {
  return structuredClone(tasks[key] as TaskRun);
}

function buildRun(status: Run['status'], finishedAt?: number): Run {
  return {
    id: RUN_ID,
    goal,
    plan,
    tasks: structuredClone(tasks),
    status,
    integrationBranch: INTEGRATION_BRANCH,
    startedAt: BASE_TS,
    ...(finishedAt === undefined ? {} : { finishedAt }),
    metrics: metricsAt(finishedAt === undefined ? 0 : (finishedAt - BASE_TS) / 1000),
  };
}

function transition(tsSec: number, key: string, to: TaskStatus, patch: Partial<TaskRun> = {}): void {
  const task = tasks[key] as TaskRun;
  const from = task.status;
  Object.assign(task, patch, { status: to });
  statusAt.push({ tsMs: at(tsSec), key, status: to });
  push(tsSec, {
    type: 'task.status',
    runId: RUN_ID,
    ts: at(tsSec),
    payload: { taskKey: key, from, to, run: snapshot(key) },
  });
}

const metricTransitions = statusAt;

function metricsAt(tsSec: number): Run['metrics'] {
  const cutoff = at(tsSec);
  const latest = new Map<string, TaskStatus>();
  for (const entry of metricTransitions) {
    if (entry.tsMs <= cutoff) latest.set(entry.key, entry.status);
  }
  let agentsActive = 0;
  let tasksMerged = 0;
  for (const status of latest.values()) {
    if (status === 'running' || status === 'fixing') agentsActive += 1;
    if (status === 'merged') tasksMerged += 1;
  }
  const apiUsage = emptyUsage();
  const localUsage = emptyUsage();
  for (const entry of usageLog) {
    if (entry.tsMs > cutoff) continue;
    const target = entry.bucket === 'api' ? apiUsage : localUsage;
    target.input += entry.usage.input;
    target.output += entry.usage.output;
    target.cached += entry.usage.cached;
  }
  return {
    agentsActive,
    tasksMerged,
    tasksFailed: 0,
    apiUsage,
    localUsage,
    apiCostUsd: usageCostUsd(API_MODEL, apiUsage),
    localCallCount: localCallsAt(tsSec),
    estSavedUsd: usageCostUsd(API_MODEL, localUsage),
    elapsedMs: Math.round(tsSec * 1000),
  };
}

const localCallsAtTimes: Array<{ tsMs: number; n: number }> = [];
function localCallsAt(tsSec: number): number {
  let n = 0;
  for (const entry of localCallsAtTimes) if (entry.tsMs <= at(tsSec)) n = entry.n;
  return n;
}

function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cached: 0 };
}

function addUsageToTask(key: string, usage: TokenUsage): void {
  const task = tasks[key] as TaskRun;
  task.usage.input += usage.input;
  task.usage.output += usage.output;
  task.usage.cached += usage.cached;
  task.costUsd = Math.round((task.costUsd + usageCostUsd(API_MODEL, usage)) * 1_000_000) / 1_000_000;
}

// ── nodes ──────────────────────────────────────────────────────────────────────────────────────
function nodeInfo(
  tsSec: number,
  kind: 'hub' | 'air',
  activeSessions: number,
  status: NodeInfo['status'] = 'online',
): NodeInfo {
  if (kind === 'hub') {
    return {
      id: 'hub',
      name: 'MacBook Pro',
      kind: 'local',
      platform: 'darwin',
      arch: 'arm64',
      cpuCores: 12,
      memGb: 32,
      maxSessions: 8,
      activeSessions,
      localModels: [LOCAL_MODEL],
      status: activeSessions > 0 ? 'busy' : status,
      lastSeen: at(tsSec),
      latencyMs: 1,
    };
  }
  return {
    id: 'air',
    name: 'MacBook Air',
    kind: 'remote',
    url: 'http://192.168.1.42:7778',
    platform: 'darwin',
    arch: 'arm64',
    cpuCores: 8,
    memGb: 16,
    maxSessions: 5,
    activeSessions,
    localModels: [LOCAL_MODEL],
    status: status === 'offline' ? 'offline' : activeSessions > 0 ? 'busy' : status,
    lastSeen: at(tsSec),
    latencyMs: 18,
  };
}

function nodeJoined(tsSec: number, node: NodeInfo): void {
  push(tsSec, { type: 'node.joined', runId: '*', ts: at(tsSec), payload: { node } });
}

function nodeStats(tsSec: number, node: NodeInfo): void {
  push(tsSec, { type: 'node.stats', runId: '*', ts: at(tsSec), payload: { node } });
}

// ── agent streams ─────────────────────────────────────────────────────────────────────────────
interface SessionOptions {
  intro: string;
  file: string;
  added: number;
  removed: number;
  usage: TokenUsage;
  span: number;
  nodeId: string;
}

function agentEvent(
  tsSec: number,
  key: string,
  sessionId: string,
  kind: AgentEventKind,
  data: Record<string, unknown>,
): void {
  push(tsSec, {
    type: 'agent.event',
    runId: RUN_ID,
    ts: at(tsSec),
    payload: { runId: RUN_ID, taskKey: key, sessionId, ts: at(tsSec), kind, data },
  });
}

/** Emit one worker turn (started → tools → edit → usage → idle). Returns the idle timestamp. */
function runSession(t0: number, key: string, sessionId: string, opts: SessionOptions): number {
  const usage = opts.usage;
  agentEvent(t0, key, sessionId, 'session.started', {
    model: API_MODEL_REF,
    nodeId: opts.nodeId,
  });
  agentEvent(t0 + 1, key, sessionId, 'text', {
    text: opts.intro,
  });
  agentEvent(t0 + 2.5, key, sessionId, 'tool.call', { tool: 'read', path: opts.file });
  agentEvent(t0 + 2.9, key, sessionId, 'tool.result', { ok: true, bytes: 1180 });
  agentEvent(t0 + opts.span * 0.4, key, sessionId, 'tool.call', {
    tool: 'edit',
    path: opts.file,
    added: opts.added,
    removed: opts.removed,
  });
  agentEvent(t0 + opts.span * 0.45, key, sessionId, 'tool.result', { ok: true });
  agentEvent(t0 + opts.span, key, sessionId, 'file.edited', {
    path: opts.file,
    added: opts.added,
    removed: opts.removed,
  });
  agentEvent(t0 + opts.span + 1, key, sessionId, 'text', {
    text: `Edited ${opts.file}. Running bun test before handing back.`,
  });
  agentEvent(t0 + opts.span + 1.6, key, sessionId, 'tool.call', { tool: 'bash', command: 'bun test' });
  agentEvent(t0 + opts.span + 2.2, key, sessionId, 'tool.result', { ok: true, tests: '12 pass' });
  agentEvent(t0 + opts.span + 2.8, key, sessionId, 'usage', {
    model: API_MODEL_REF,
    ...usage,
    local: false,
  });
  agentEvent(t0 + opts.span + 3, key, sessionId, 'session.idle', {});
  usageLog.push({ tsMs: at(t0 + opts.span + 2.8), bucket: 'api', usage });
  addUsageToTask(key, usage);
  return t0 + opts.span + 3;
}

// ── audit / merge ─────────────────────────────────────────────────────────────────────────────
interface AuditOptions {
  attempt: number;
  pass: boolean;
  fixInstructions?: string;
  summary: string;
}

function audit(tsSec: number, key: string, opts: AuditOptions): void {
  const usage: TokenUsage = { input: 4800, output: 620, cached: 1600 };
  usageLog.push({ tsMs: at(tsSec), bucket: 'local', usage });
  localCalls += 1;
  localCallsAtTimes.push({ tsMs: at(tsSec), n: localCalls });

  const verdict: AuditVerdict = {
    taskKey: key,
    attempt: opts.attempt,
    pass: opts.pass,
    checks: [
      {
        name: 'tests',
        ok: opts.pass,
        detail: opts.pass ? 'bun test: 14 pass, 0 fail' : 'bun test: 1 failing test in src/features/theme',
      },
      { name: 'lane', ok: true, detail: 'No files outside the lane were touched' },
      {
        name: 'definition-of-done',
        ok: opts.pass,
        detail: opts.pass ? 'Every DoD item is satisfied' : 'Missing: toggle persists across reloads',
      },
    ],
    laneViolations: [],
    summary: opts.summary,
    model: LOCAL_MODEL_REF,
    ts: at(tsSec),
    ...(opts.fixInstructions === undefined ? {} : { fixInstructions: opts.fixInstructions }),
  };
  const task = tasks[key] as TaskRun;
  task.lastVerdict = verdict;
  if (!opts.pass) task.attempts = opts.attempt;
  push(tsSec, { type: 'audit.verdict', runId: RUN_ID, ts: at(tsSec), payload: verdict });
}

let mergeCount = 0;
function merge(tsSec: number, key: string, status: MergeResult['status'], detail: string): void {
  mergeCount += 1;
  const result: MergeResult = {
    taskKey: key,
    status,
    conflictedFiles: [],
    detail,
    ts: at(tsSec),
    ...(status === 'merged' ? { commit: `c0ffee${String(mergeCount).padStart(3, '0')}` } : {}),
  };
  push(tsSec, { type: 'merge.result', runId: RUN_ID, ts: at(tsSec), payload: result });
}

function branchFor(key: string): string {
  return `starling/${RUN_ID.slice(-6)}/${key}`;
}

function dispatch(tsSec: number, key: string, nodeId: 'hub' | 'air', attempt = 0): string {
  const sessionId = `ses_${key.replace(/-/g, '')}_${nodeId}_${attempt + 1}`;
  const worktreePath =
    nodeId === 'hub'
      ? `../.starling-worktrees/${RUN_ID.slice(-6)}-${key}`
      : `/Users/moksh/.starling/perch/worktrees/${RUN_ID.slice(-6)}-${key}`;
  transition(tsSec, key, 'running', {
    branch: branchFor(key),
    worktreePath,
    sessionId,
    nodeId,
    attempts: attempt,
    startedAt: at(tsSec),
  });
  return sessionId;
}

// ── plan of record ────────────────────────────────────────────────────────────────────────────
push(0, { type: 'run.created', runId: RUN_ID, ts: at(0), payload: { run: buildRun('mapping') } });
nodeJoined(1, nodeInfo(1, 'hub', 0));

// Repo mapping uses the local summarizer: cheap, private, free.
usageLog.push({ tsMs: at(3.2), bucket: 'local', usage: { input: 14800, output: 1600, cached: 5200 } });
localCalls = 1;
localCallsAtTimes.push({ tsMs: at(3.2), n: 1 });
push(4, {
  type: 'repomap.ready',
  runId: RUN_ID,
  ts: at(4),
  payload: { files: 17, tokenEstimate: 2480 },
});
push(8, {
  type: 'plan.created',
  runId: RUN_ID,
  ts: at(8),
  payload: { plan, issues: [] },
});

// Everything except the two dependent tasks is ready at once.
transition(12, 'theme', 'ready');
transition(12.2, 'search', 'ready');
transition(12.4, 'csv-export', 'ready');
transition(12.6, 'shortcuts', 'ready');
transition(12.8, 'dates-fix', 'ready');

// The hub runs four agents; search waits for the perch that joins later.
const themeSession = dispatch(14, 'theme', 'hub');
const csvSession = dispatch(14.2, 'csv-export', 'hub');
const shortcutsSession = dispatch(14.4, 'shortcuts', 'hub');
const datesSession = dispatch(14.6, 'dates-fix', 'hub');
nodeStats(20, nodeInfo(20, 'hub', 4));

// dates-fix is small and fast; it unblocks due-badges.
const datesIdle = runSession(16, 'dates-fix', datesSession, {
  intro: 'Reading src/lib/dates.ts and the existing tests before changing the comparison.',
  file: 'src/lib/dates.ts',
  added: 34,
  removed: 18,
  usage: { input: 12400, output: 1800, cached: 3200 },
  span: 24,
  nodeId: 'hub',
});
transition(datesIdle + 1, 'dates-fix', 'auditing');
audit(datesIdle + 2, 'dates-fix', {
  attempt: 1,
  pass: true,
  summary: 'Calendar-day comparison is correct and both regression tests fail on the old code.',
});
transition(datesIdle + 3, 'dates-fix', 'merging');
merge(datesIdle + 5, 'dates-fix', 'merged', 'Merged into integration; bun test 16 pass');
transition(datesIdle + 5, 'dates-fix', 'merged', { finishedAt: at(datesIdle + 5) });
transition(datesIdle + 6, 'due-badges', 'ready');

// csv-export finishes next.
const csvIdle = runSession(17, 'csv-export', csvSession, {
  intro: 'Adding a CSV serializer with RFC 4180 escaping and a download button.',
  file: 'src/features/export/index.ts',
  added: 96,
  removed: 0,
  usage: { input: 15300, output: 2400, cached: 4100 },
  span: 32,
  nodeId: 'hub',
});
transition(csvIdle + 1, 'csv-export', 'auditing');
audit(csvIdle + 2, 'csv-export', {
  attempt: 1,
  pass: true,
  summary: 'Round-trip test covers commas, quotes and newlines; the button disables on an empty list.',
});
transition(csvIdle + 3, 'csv-export', 'merging');
merge(csvIdle + 5, 'csv-export', 'merged', 'Merged into integration; bun test 22 pass');
transition(csvIdle + 5, 'csv-export', 'merged', { finishedAt: at(csvIdle + 5) });

// shortcuts finishes before help-overlay can start.
const shortcutsIdle = runSession(18, 'shortcuts', shortcutsSession, {
  intro: 'Adding a global keydown handler that ignores events from inputs and textareas.',
  file: 'src/features/shortcuts/index.ts',
  added: 74,
  removed: 2,
  usage: { input: 13800, output: 2100, cached: 3800 },
  span: 38,
  nodeId: 'hub',
});
transition(shortcutsIdle + 1, 'shortcuts', 'auditing');
audit(shortcutsIdle + 2, 'shortcuts', {
  attempt: 1,
  pass: true,
  summary: 'Shortcuts are inert inside form fields; Escape closes the overlay.',
});
transition(shortcutsIdle + 3, 'shortcuts', 'merging');
merge(shortcutsIdle + 5, 'shortcuts', 'merged', 'Merged into integration; bun test 27 pass');
transition(shortcutsIdle + 5, 'shortcuts', 'merged', { finishedAt: at(shortcutsIdle + 5) });
transition(shortcutsIdle + 6, 'help-overlay', 'ready');

// theme fails its first audit: the local model catches a missing persistence test.
const themeIdle = runSession(16.5, 'theme', themeSession, {
  intro: 'Adding a data-theme toggle and dark tokens in the stylesheet.',
  file: 'src/features/theme/index.ts',
  added: 88,
  removed: 6,
  usage: { input: 16200, output: 2600, cached: 4300 },
  span: 42,
  nodeId: 'hub',
});
transition(themeIdle + 1, 'theme', 'auditing');
audit(themeIdle + 2, 'theme', {
  attempt: 1,
  pass: false,
  summary: 'The toggle works, but nothing proves the choice survives a reload.',
  fixInstructions:
    'Add a test that mounts initTheme() twice with a stubbed localStorage and asserts the second mount reads data-theme="dark". Keep the change inside src/features/theme/**.',
});
transition(themeIdle + 3, 'theme', 'fixing', { attempts: 1 });
agentEvent(themeIdle + 4, 'theme', themeSession, 'text', {
  text: 'Picking up the fix: add the persistence test and re-run the suite.',
});
const themeFixIdle = runSession(themeIdle + 6, 'theme', themeSession, {
  intro: 'Adding a localStorage-backed test for the theme toggle.',
  file: 'src/features/theme/index.test.ts',
  added: 41,
  removed: 0,
  usage: { input: 9200, output: 1400, cached: 2600 },
  span: 20,
  nodeId: 'hub',
});
transition(themeFixIdle + 1, 'theme', 'auditing');
audit(themeFixIdle + 2, 'theme', {
  attempt: 2,
  pass: true,
  summary: 'Persistence is now covered; every DoD item passes.',
});
transition(themeFixIdle + 3, 'theme', 'merging');
merge(themeFixIdle + 5, 'theme', 'merged', 'Merged into integration; bun test 30 pass');
transition(themeFixIdle + 5, 'theme', 'merged', { finishedAt: at(themeFixIdle + 5) });

// A second roost joins the flock.
nodeJoined(90, nodeInfo(90, 'air', 0));
nodeStats(90, nodeInfo(90, 'hub', 1));

// Work flows to the Air.
const searchSession = dispatch(95, 'search', 'air');
const dueSession = dispatch(96, 'due-badges', 'air');
const helpSession = dispatch(97, 'help-overlay', 'air');
nodeStats(99, nodeInfo(99, 'air', 3));

const dueIdle = runSession(98, 'due-badges', dueSession, {
  intro: 'Using the fixed isOverdue() helper to compute badge states.',
  file: 'src/features/due-dates/index.ts',
  added: 63,
  removed: 0,
  usage: { input: 11900, output: 1750, cached: 3100 },
  span: 46,
  nodeId: 'air',
});
transition(dueIdle + 1, 'due-badges', 'auditing');
audit(dueIdle + 2, 'due-badges', {
  attempt: 1,
  pass: true,
  summary: 'Yesterday shows Overdue, today shows Today, and no Date is mutated in place.',
});
transition(dueIdle + 3, 'due-badges', 'merging');
merge(dueIdle + 5, 'due-badges', 'merged', 'Merged into integration; bun test 34 pass');
transition(dueIdle + 5, 'due-badges', 'merged', { finishedAt: at(dueIdle + 5) });

const helpIdle = runSession(100, 'help-overlay', helpSession, {
  intro: 'Building the help dialog with a focus trap and backdrop close.',
  file: 'src/features/help/index.ts',
  added: 112,
  removed: 0,
  usage: { input: 14100, output: 2300, cached: 3700 },
  span: 58,
  nodeId: 'air',
});
transition(helpIdle + 1, 'help-overlay', 'auditing');
audit(helpIdle + 2, 'help-overlay', {
  attempt: 1,
  pass: true,
  summary: 'Escape and the backdrop both close the dialog, and focus returns to the trigger.',
});
transition(helpIdle + 3, 'help-overlay', 'merging');
merge(helpIdle + 5, 'help-overlay', 'merged', 'Merged into integration; bun test 39 pass');
transition(helpIdle + 5, 'help-overlay', 'merged', { finishedAt: at(helpIdle + 5) });

// search is long-running; the Air's lid closes mid-task, so this attempt streams only its early
// events and never reaches session.idle (the work is lost; the branch survives).
agentEvent(96, 'search', searchSession, 'session.started', { model: API_MODEL_REF, nodeId: 'air' });
agentEvent(97, 'search', searchSession, 'text', {
  text: 'Mounting the search input and wiring it to store.setQuery.',
});
agentEvent(99, 'search', searchSession, 'tool.call', { tool: 'read', path: 'src/features/search/index.ts' });
agentEvent(99.4, 'search', searchSession, 'tool.result', { ok: true, bytes: 1180 });
agentEvent(120, 'search', searchSession, 'tool.call', {
  tool: 'edit',
  path: 'src/features/search/index.ts',
  added: 91,
  removed: 3,
});
agentEvent(120.4, 'search', searchSession, 'tool.result', { ok: true });
agentEvent(150, 'search', searchSession, 'text', {
  text: 'Filtering works; adding the empty state and Escape handling next.',
});
agentEvent(175, 'search', searchSession, 'tool.call', { tool: 'bash', command: 'bun test' });

// The Air disappears before it can go idle.
nodeStats(180, nodeInfo(180, 'air', 3));
nodeStats(185, nodeInfo(185, 'hub', 1));
push(190, {
  type: 'node.left',
  runId: '*',
  ts: at(190),
  payload: { nodeId: 'air', reason: 'heartbeat lost for 15s (lid closed)' },
});
transition(190.4, 'search', 'ready', { nodeId: undefined, sessionId: undefined });
push(190.6, {
  type: 'task.migrated',
  runId: RUN_ID,
  ts: at(190.6),
  payload: { taskKey: 'search', fromNode: 'air', toNode: 'hub', reason: 'air went offline' },
});
const searchSecondSession = dispatch(191, 'search', 'hub', 1);
nodeStats(192, nodeInfo(192, 'hub', 1));

// The rescheduled attempt restarts from the branch (the Air's bundle never arrived).
const searchIdle = runSession(193, 'search', searchSecondSession, {
  intro: 'Resuming search filtering on the hub after the Air dropped; the branch is intact.',
  file: 'src/features/search/index.ts',
  added: 91,
  removed: 3,
  usage: { input: 10600, output: 1700, cached: 2800 },
  span: 58,
  nodeId: 'hub',
});
transition(searchIdle + 1, 'search', 'auditing');
audit(searchIdle + 2, 'search', {
  attempt: 2,
  pass: true,
  summary: 'Filtering is live, Escape clears, and the empty state renders.',
});
transition(searchIdle + 3, 'search', 'merging');
merge(searchIdle + 5, 'search', 'merged', 'Merged into integration; bun test 43 pass');
transition(searchIdle + 5, 'search', 'merged', { finishedAt: at(searchIdle + 5) });

// The Air comes back, lighter.
nodeJoined(215, nodeInfo(215, 'air', 0));
nodeStats(220, nodeInfo(220, 'air', 0));
nodeStats(240, nodeInfo(240, 'hub', 0));

// Integration-branch verification.
push(275, {
  type: 'log',
  runId: RUN_ID,
  ts: at(275),
  payload: { level: 'info', msg: 'Running the full suite on the integration branch' },
});
push(288, {
  type: 'log',
  runId: RUN_ID,
  ts: at(288),
  payload: { level: 'info', msg: 'Integration branch green: 43 pass, 0 fail' },
});
push(300, {
  type: 'log',
  runId: RUN_ID,
  ts: at(300),
  payload: { level: 'debug', msg: 'All 7 tasks merged; writing the run summary' },
});
nodeStats(320, nodeInfo(320, 'hub', 0));

// Metrics ticks every 5 seconds for the whole run.
for (let sec = 0; sec <= 355; sec += 5) {
  push(sec, { type: 'metrics', runId: RUN_ID, ts: at(sec), payload: metricsAt(sec) });
}

const finishedAt = at(356);
const finalMetrics = metricsAt(356);
push(356, {
  type: 'run.finished',
  runId: RUN_ID,
  ts: finishedAt,
  payload: {
    run: { ...buildRun('finished', finishedAt), metrics: finalMetrics },
    summary: `Seven tasks merged into ${INTEGRATION_BRANCH} in 5m 56s. One audit failure on theme was fixed on attempt 2; the Air joined, took three tasks, dropped, and its search task migrated back to the hub without losing the branch. API spend $${finalMetrics.apiCostUsd.toFixed(3)}, local audits saved an estimated $${finalMetrics.estSavedUsd.toFixed(3)}.`,
  },
});

// ── validate + write ─────────────────────────────────────────────────────────────────────────
events.sort((a, b) => a.ts - b.ts);
for (const event of events) {
  const parsed = StarlingEventSchema.safeParse(event);
  if (!parsed.success) {
    console.error(`Invalid event at ts ${event.ts}:`, JSON.stringify(event, null, 2));
    console.error(parsed.error.message);
    process.exit(1);
  }
}

const outPath = join(ROOT, 'fixtures/runs/sky-todo-launch-day.jsonl');
writeFileSync(outPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
console.log(`Wrote ${events.length} events to ${outPath}`);
