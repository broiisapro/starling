/**
 * Flock loopback E2E: two real perches, real HTTP, real git bundles, no LLM.
 *
 * What is real here:
 * - `createRegistry` + `createLocalNode` + `createFlockHub` + the four hub routes (`hub-server.ts`);
 * - two `startPerch` daemons on ports 7781/7782 (falling back to ephemeral when busy), each with its
 *   own state root, real `Workspace` worktrees and real `git bundle` transfer;
 * - `createRemoteNode` doing `startTask → events → collect → bundle → fetch into the hub repo`;
 * - a hub-side merge so the next task starts from a moved integration branch.
 *
 * What is deliberately fake:
 * - the agent: `ReplayRunner` (see `replay-agent.ts`) writes a deterministic file instead of calling a
 *   model, so the run is fast, offline and deterministic;
 * - the engine: this script plays the dispatcher (pick → start → wait idle → collect). Rescheduling
 *   after a leave is modelled the way the engine will do it: re-dispatch the task to the scheduler's
 *   next choice. `packages/engine` (Epic 49) owns the real state machine.
 *
 * Run it with `bun tools/flock/loopback.ts`. The test version is `loopback.e2e.test.ts`.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import {
  type AgentEvent,
  exec as coreExec,
  type ExecutionNode,
  type Scheduler,
  StarlingError,
  type StartTaskOptions,
  type TaskSpec,
} from '../../packages/core/src/index.ts';
import {
  createLocalNode,
  createScheduler,
  type LocalNode,
  type RemoteNode,
} from '../../packages/flock/src/index.ts';
import { type PerchHandle, startPerch } from '../../packages/perch/src/index.ts';
import { createWorkspace } from '../../packages/workspace/src/index.ts';
import { type LoopbackHub, startLoopbackHub } from './hub-server.ts';
import { createReplayAgent } from './replay-agent.ts';

const RUN_ID = 'loop-run';
const INTEGRATION = 'starling/loopback/integration';
const BRANCH_PREFIX = 'starling/loopback';
const GIT_IDENTITY = ['-c', 'user.name=Starling Loopback', '-c', 'user.email=loopback@starling.local'];

export interface LoopbackOptions {
  /** Print a readable trace. Defaults to false (the test is quiet, the script passes true). */
  verbose?: boolean;
  /** Preferred perch ports. Each falls back to an ephemeral port when the port is taken. */
  port1?: number;
  port2?: number;
  /** A perch missing for this long is `offline`. Default 800 ms keeps the crash demo quick. */
  offlineAfterMs?: number;
  log?: (line: string) => void;
  /** Keep the temp repo and perch state for inspection. Default false. */
  keepTemp?: boolean;
}

export interface LoopbackLeave {
  nodeId: string;
  reason: string;
}

export interface LoopbackTaskSummary {
  key: string;
  nodeId: string;
  branch: string;
  /** Commit the perch produced. */
  commit: string;
  /** Commit the hub now has on `branch` after importing the bundle. */
  hubCommit: string;
  changedFiles: string[];
  events: string[];
  /** Set when the task was re-dispatched after its first perch left. */
  rescheduledFrom?: string;
}

export interface LoopbackSummary {
  hubUrl: string;
  code: string;
  perches: Array<{ id: string; name: string; url: string }>;
  tasks: LoopbackTaskSummary[];
  leaves: LoopbackLeave[];
  elapsedMs: number;
  /** Where the temp repo lived (removed unless `keepTemp`). */
  root: string;
}

interface Perch {
  id: string;
  name: string;
  url: string;
  node: LocalNode;
  handle: PerchHandle;
  /** Simulate a network partition: heartbeats to the hub stop arriving. */
  partition(on: boolean): void;
  stop(): Promise<void>;
}

function taskSpec(key: string, title: string): TaskSpec {
  return {
    key,
    title,
    goal: title,
    deliverables: [`src/${key}.ts`],
    outOfScope: [],
    definitionOfDone: [`src/${key}.ts exists`, 'the bundle round-trips to the hub'],
    dependsOn: [],
    lane: { owns: [`src/${key}.ts`], reads: ['src/app.ts'] },
    estimateMin: 2,
  };
}

const TASKS = [
  taskSpec('t01-sky-note', 'Add a note to the sky'),
  taskSpec('t02-wind-log', 'Log the wind'),
  taskSpec('t03-murmur', 'Count the murmuration'),
  taskSpec('t04-dusk', 'Paint the dusk'),
];

async function runGit(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return coreExec(['git', ...args], { cwd, timeoutMs: 60_000 });
}

async function gitOrThrow(args: string[], cwd: string): Promise<string> {
  const res = await runGit(args, cwd);
  if (res.code !== 0) {
    throw new StarlingError('EXEC_FAILED', `git ${args.join(' ')} failed: ${res.stderr.trim()}`, {
      details: { cwd, code: res.code },
    });
  }
  return res.stdout.trim();
}

async function seedRepo(repo: string): Promise<void> {
  await mkdir(join(repo, 'src'), { recursive: true });
  await writeFile(join(repo, 'README.md'), '# Loopback repo\n\nOnly used by the Flock E2E.\n');
  await writeFile(join(repo, 'src', 'app.ts'), 'export const app = "sky-todo";\n');
  await gitOrThrow(['init', '-b', 'main'], repo);
  await gitOrThrow(['add', '-A'], repo);
  await gitOrThrow([...GIT_IDENTITY, 'commit', '-m', 'init'], repo);
  await gitOrThrow(['branch', INTEGRATION], repo);
}

/** Hub-side merge: merge-tree + commit-tree + update-ref, with no working tree to check out. */
async function mergeIntoIntegration(repo: string, branch: string, label: string): Promise<string> {
  const tree = await gitOrThrow(['merge-tree', '--write-tree', INTEGRATION, branch], repo);
  const treeSha = tree.split('\n')[0]?.trim() ?? '';
  if (!/^[0-9a-f]{40,64}$/.test(treeSha)) {
    throw new StarlingError('WORKSPACE_ERROR', `merge-tree produced no tree for ${branch}`, {
      details: { branch, output: tree.slice(0, 400) },
    });
  }
  const commit = await gitOrThrow(
    [...GIT_IDENTITY, 'commit-tree', treeSha, '-p', INTEGRATION, '-p', branch, '-m', `merge ${label}`],
    repo,
  );
  await gitOrThrow(['update-ref', `refs/heads/${INTEGRATION}`, commit], repo);
  return commit;
}

function identifier(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9]+([A-Za-z0-9])/g, (_all, next: string) => next.toUpperCase());
  const safe = cleaned.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[0-9]/.test(safe) ? `task_${safe}` : safe;
}

async function waitFor<T>(
  fn: () => T | undefined | false | null,
  label: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) return value;
    await Bun.sleep(10);
  }
  throw new StarlingError('EXEC_TIMEOUT', `timed out after ${timeoutMs}ms waiting for ${label}`);
}

function isRemoteNode(node: ExecutionNode): node is RemoteNode {
  return typeof (node as Partial<RemoteNode>).eventsReady === 'function';
}

async function launchPerch(args: {
  hub: LoopbackHub;
  root: string;
  /** Directory name for this perch's worktrees and caches; may differ from the node id on a restart. */
  stateDir: string;
  id: string;
  name: string;
  port: number;
  log: (line: string) => void;
}): Promise<Perch> {
  const worktreeRoot = join(args.root, args.stateDir);
  const runner = createReplayAgent({
    speed: 1,
    edit: async ({ dir, taskKey }) => {
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(
        join(dir, 'src', `${taskKey}.ts`),
        `// written by the replay agent for ${taskKey}\nexport const ${identifier(taskKey)} = true;\n`,
      );
    },
  });
  const node = createLocalNode({
    id: args.id,
    name: args.name,
    workspace: createWorkspace({ worktreeRoot }),
    runner,
    maxSessions: 1,
    worktreeRoot,
    bundleDir: join(worktreeRoot, 'bundles'),
    repoCacheDir: join(worktreeRoot, 'repos'),
  });

  let partitioned = false;
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    if (partitioned && String(input).includes('/api/flock/heartbeat')) {
      throw new TypeError('simulated network partition: heartbeat dropped');
    }
    return fetch(input, init);
  }) as typeof fetch;

  const facts = {
    hostname: `${args.id}.local`,
    computerName: args.name,
    platform: platform(),
    arch: arch(),
    cpuCores: cpus().length,
    memGb: Math.round(totalmem() / 1024 ** 3),
  };

  const start = (port: number): Promise<PerchHandle> =>
    startPerch({
      node,
      hub: args.hub.url,
      code: args.hub.code,
      port,
      publicHost: '127.0.0.1',
      name: args.name,
      maxSessions: 1,
      lendModels: false,
      os: async () => facts,
      fetch: fetchFn,
      heartbeatMs: 50,
      backoffMs: 20,
      maxBackoffMs: 60,
      requestTimeoutMs: 1000,
    });

  let handle: PerchHandle;
  try {
    handle = await start(args.port);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('could not bind')) throw err;
    args.log(`  · port ${args.port} is busy, using an ephemeral one`);
    handle = await start(0);
  }

  return {
    id: args.id,
    name: args.name,
    url: handle.url,
    node,
    handle,
    partition(on) {
      partitioned = on;
    },
    stop: () => handle.stop(),
  };
}

function startOptions(task: TaskSpec, hub: LoopbackHub): StartTaskOptions {
  return {
    runId: RUN_ID,
    taskKey: task.key,
    title: task.title,
    repo: {
      kind: 'bundle',
      url: `${hub.url}/api/flock/bundle?ref=${encodeURIComponent(INTEGRATION)}`,
      token: hub.code,
    },
    fromRef: INTEGRATION,
    branch: `${BRANCH_PREFIX}/${task.key}`,
    prompt: `Loopback task: ${task.title}`,
    model: { provider: 'loopback', model: 'replay' },
  };
}

/** Subscribe to a node's events and start the task. Returns the handle and the live event list. */
async function beginTask(
  node: ExecutionNode,
  task: TaskSpec,
  hub: LoopbackHub,
): Promise<{ handle: Awaited<ReturnType<ExecutionNode['startTask']>>; seen: AgentEvent[]; off: () => void }> {
  const seen: AgentEvent[] = [];
  const off = node.onEvent((event) => {
    if (event.runId === RUN_ID && event.taskKey === task.key) seen.push(event);
  });
  // Wait for the perch's SSE stream to be open so `session.started` cannot race the subscription.
  if (isRemoteNode(node)) await node.eventsReady();
  const handle = await node.startTask(startOptions(task, hub));
  return { handle, seen, off };
}

async function runTask(args: {
  task: TaskSpec;
  nodeId: string;
  hub: LoopbackHub;
  repo: string;
  rescheduledFrom?: string;
  log: (line: string) => void;
}): Promise<LoopbackTaskSummary> {
  const node = args.hub.registry.get(args.nodeId);
  if (node === undefined) throw new StarlingError('NODE_OFFLINE', `no node ${args.nodeId}`);
  const branch = `${BRANCH_PREFIX}/${args.task.key}`;

  const { handle, seen, off } = await beginTask(node, args.task, args.hub);
  try {
    await waitFor(
      () => seen.some((event) => event.kind === 'session.idle'),
      `session.idle for ${args.task.key} on ${args.nodeId}`,
      8000,
    );
    const result = await node.collect(handle, args.repo, INTEGRATION);
    const hubCommit = await gitOrThrow(['rev-parse', '--verify', `refs/heads/${branch}`], args.repo);
    await mergeIntoIntegration(args.repo, branch, args.task.key);
    await node.cleanup(handle).catch(() => undefined);

    return {
      key: args.task.key,
      nodeId: args.nodeId,
      branch,
      commit: result.commit,
      hubCommit,
      changedFiles: result.changedFiles,
      events: seen.map((event) => event.kind),
      ...(args.rescheduledFrom === undefined ? {} : { rescheduledFrom: args.rescheduledFrom }),
    };
  } finally {
    off();
  }
}

async function pickNode(
  scheduler: Scheduler,
  hub: LoopbackHub,
  task: TaskSpec,
  timeoutMs = 5000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodeId = scheduler.pick(hub.registry.list(), task);
    if (nodeId !== undefined && nodeId !== 'hub') return nodeId;
    await Bun.sleep(10);
  }
  throw new StarlingError('NODE_OFFLINE', `no perch with a free slot for ${task.key}`);
}

/**
 * Drive the whole loopback and return what happened.
 *
 * Phases:
 * 1. two tasks in parallel, one per perch (real registration, scheduling, bundles, import, merge);
 * 2. a third task killed mid-flight with a graceful `starling perch` stop → `left` `perch-stopped`
 *    → re-dispatched to the surviving perch;
 * 3. a fourth task on a reconnected perch whose heartbeats are cut → `left` `heartbeat-timeout`
 *    → re-dispatched. This is the "lid closed / Wi-Fi died" path the registry sweep exists for.
 */
export async function runLoopback(options: LoopbackOptions = {}): Promise<LoopbackSummary> {
  const log =
    options.log ??
    ((line: string) => {
      if (options.verbose === true) console.log(line);
    });
  const startedAt = Date.now();
  const root = await mkdtemp(join(tmpdir(), 'starling-flock-loopback-'));
  const repo = join(root, 'repo');
  await seedRepo(repo);

  const hub = await startLoopbackHub({
    repoPath: repo,
    root,
    port: 0,
    code: 'LOOP-BACK',
    offlineAfterMs: options.offlineAfterMs ?? 800,
    sweepMs: 100,
    maxSessions: 0,
  });

  const perches: Perch[] = [];
  const leaves: LoopbackLeave[] = [];
  const summaries: LoopbackTaskSummary[] = [];
  const scheduler = createScheduler();

  hub.registry.onChange((event) => {
    if (event.type !== 'left') return;
    leaves.push({ nodeId: event.node.id, reason: event.reason ?? 'unknown' });
    log(`  ⚠ ${event.node.id} left the flock (${event.reason ?? 'unknown'})`);
  });

  log(`🪺 hub      ${hub.url}  code ${hub.code}`);
  log(`   hub has 0 session slots: every task must run on a perch`);

  try {
    const [t1, t2, t3, t4] = TASKS;
    if (t1 === undefined || t2 === undefined || t3 === undefined || t4 === undefined) {
      throw new StarlingError('UNKNOWN', 'loopback task fixtures are missing');
    }

    const perch1 = await launchPerch({
      hub,
      root,
      stateDir: 'perch-1',
      id: 'loop-perch-1',
      name: 'Loop Perch One',
      port: options.port1 ?? 7781,
      log,
    });
    const perch2 = await launchPerch({
      hub,
      root,
      stateDir: 'perch-2',
      id: 'loop-perch-2',
      name: 'Loop Perch Two',
      port: options.port2 ?? 7782,
      log,
    });
    perches.push(perch1, perch2);
    log(`🐦 ${perch1.id}  ${perch1.url}`);
    log(`🐦 ${perch2.id}  ${perch2.url}`);

    await waitFor(
      () => hub.registry.list().filter((node) => node.id !== 'hub').length === 2,
      'both perches to register',
    );
    log(
      `   registered: ${hub.registry
        .list()
        .map((node) => node.id)
        .join(', ')}`,
    );

    // ── Phase 1: two tasks in parallel, one per perch ────────────────────────────────────────────
    const firstNode = await pickNode(scheduler, hub, t1);
    log(`→ ${t1.key} → ${firstNode}`);
    const first = runTask({ task: t1, nodeId: firstNode, hub, repo, log });

    // The scheduler reads the registry, which hears about capacity on the next heartbeat. Waiting for
    // that is what the real engine must do too; without it the second dispatch double-books perch 1.
    await waitFor(
      () => (hub.registry.list().find((node) => node.id === firstNode)?.activeSessions ?? 0) > 0,
      'the first session to appear on the hub',
      3000,
    );
    const secondNode = await pickNode(scheduler, hub, t2);
    log(`→ ${t2.key} → ${secondNode}`);
    const second = runTask({ task: t2, nodeId: secondNode, hub, repo, log });

    summaries.push(await first, await second);
    for (const task of summaries) {
      log(`  ✔ ${task.key} on ${task.nodeId} → ${task.changedFiles.join(', ') || '(no files)'}`);
    }
    log(`   integration now at ${await gitOrThrow(['rev-parse', '--short', INTEGRATION], repo)}`);

    // ── Phase 2: kill a perch mid-task (graceful stop) ──────────────────────────────────────────
    // Wait for the post-collect heartbeats so the scheduler sees two idle perches and the id
    // tie-break picks perch one (the one this phase kills).
    await waitFor(
      () => hub.registry.list().every((node) => node.id === 'hub' || node.activeSessions === 0),
      'the perches to report idle again',
      3000,
    );
    const doomedNodeId = await pickNode(scheduler, hub, t3);
    log(`→ ${t3.key} → ${doomedNodeId} (will be stopped mid-task)`);
    const doomedNode = hub.registry.get(doomedNodeId);
    if (doomedNode === undefined) throw new StarlingError('NODE_OFFLINE', `${doomedNodeId} vanished`);
    const running = await beginTask(doomedNode, t3, hub);
    try {
      await waitFor(() => running.seen.length >= 2, `${t3.key} to start producing events`, 3000);
      log(`  ✂ stopping ${doomedNodeId} while ${t3.key} is running`);
      await (doomedNodeId === perch1.id ? perch1 : perch2).stop();
      await waitFor(
        () => leaves.some((leave) => leave.nodeId === doomedNodeId && leave.reason === 'perch-stopped'),
        'the graceful leave',
        3000,
      );
    } finally {
      running.off();
    }

    const rescuedBy = await pickNode(scheduler, hub, t3);
    log(`  ↻ ${t3.key} re-dispatched to ${rescuedBy}`);
    summaries.push(
      await runTask({ task: t3, nodeId: rescuedBy, hub, repo, rescheduledFrom: doomedNodeId, log }),
    );
    log(`  ✔ ${t3.key} on ${rescuedBy} after ${doomedNodeId} left`);

    // ── Phase 3: a perch that stops heartbeating (crash / lid closed) ───────────────────────────
    const reconnected = await launchPerch({
      hub,
      root,
      stateDir: 'perch-1b',
      id: perch1.id,
      name: perch1.name,
      port: 0,
      log,
    });
    perches.push(reconnected);
    await waitFor(
      () => hub.registry.list().some((node) => node.id === reconnected.id && node.status !== 'offline'),
      `${reconnected.id} to rejoin`,
    );
    log(`🐦 ${reconnected.id}  ${reconnected.url}  (rejoined)`);

    await waitFor(
      () => hub.registry.list().every((node) => node.id === 'hub' || node.activeSessions === 0),
      'the surviving perch to report idle',
      3000,
    );
    const crashNodeId = await pickNode(scheduler, hub, t4);
    log(`→ ${t4.key} → ${crashNodeId} (heartbeats will be cut)`);
    if (crashNodeId !== reconnected.id) {
      throw new StarlingError(
        'UNKNOWN',
        `expected ${reconnected.id} to win the tie-break, got ${crashNodeId}`,
      );
    }
    const crashNode = hub.registry.get(crashNodeId);
    if (crashNode === undefined) throw new StarlingError('NODE_OFFLINE', `${crashNodeId} vanished`);
    const crashTask = await beginTask(crashNode, t4, hub);
    try {
      await waitFor(() => crashTask.seen.length >= 2, `${t4.key} to start producing events`, 3000);
      reconnected.partition(true);
      log(`  📴 ${crashNodeId} stopped heartbeating`);
      await waitFor(
        () => leaves.some((leave) => leave.nodeId === crashNodeId && leave.reason === 'heartbeat-timeout'),
        'the heartbeat timeout',
        5000,
      );
    } finally {
      crashTask.off();
    }

    const crashRescuedBy = await pickNode(scheduler, hub, t4);
    log(`  ↻ ${t4.key} re-dispatched to ${crashRescuedBy}`);
    summaries.push(
      await runTask({ task: t4, nodeId: crashRescuedBy, hub, repo, rescheduledFrom: crashNodeId, log }),
    );
    log(`  ✔ ${t4.key} on ${crashRescuedBy} after ${crashNodeId} timed out`);

    return {
      hubUrl: hub.url,
      code: hub.code,
      perches: perches.map((perch) => ({ id: perch.id, name: perch.name, url: perch.url })),
      // Snapshot both arrays: the cleanup below stops every perch, which publishes more `left`
      // events. The summary is about the run, not about the teardown.
      tasks: [...summaries],
      leaves: [...leaves],
      elapsedMs: Date.now() - startedAt,
      root,
    };
  } finally {
    for (const perch of [...perches].reverse()) {
      await perch.stop().catch(() => undefined);
    }
    await hub.close();
    if (options.keepTemp !== true) await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const summary = await runLoopback({ verbose: true, keepTemp: process.env.STARLING_KEEP_TEMP === '1' });
  console.log('');
  console.log(`✔ loopback finished in ${summary.elapsedMs} ms`);
  console.log(`  hub     ${summary.hubUrl} (code ${summary.code})`);
  for (const task of summary.tasks) {
    const from = task.rescheduledFrom === undefined ? '' : ` (rescued from ${task.rescheduledFrom})`;
    console.log(
      `  task    ${task.key.padEnd(14)} on ${task.nodeId}${from} → ${task.branch} [${task.changedFiles.join(', ')}]`,
    );
  }
  for (const leave of summary.leaves) {
    console.log(`  leave   ${leave.nodeId} (${leave.reason})`);
  }
  console.log(`  events  ${summary.tasks.reduce((sum, task) => sum + task.events.length, 0)} agent events`);
}
