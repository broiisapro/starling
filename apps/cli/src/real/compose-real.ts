/**
 * The real composition: every package wired into one stack (ARCHITECTURE §4, §7 L20).
 *
 * ```ts
 * const composition = composeReal(config, { repoPath: '/tmp/sky-e2e-1' });
 * const { runId } = await composition.engine.start({ goal, repoPath });
 * const run = await composition.engine.waitForFinish(runId);
 * await composition.close();
 * ```
 *
 * Build order matters twice:
 * 1. **The runner comes first**, because the `opencode` LLM profile routes planner/auditor/writer
 *    completions through the *same* `opencode serve` the agents run on. In `spawn` mode the runner
 *    picks a free port and mints a password, so the provider settings are patched from `runner.url()`
 *    and the password is handed to the LLM router through its env map.
 * 2. **The registry comes before the engine**, because the engine only knows nodes through it.
 *
 * Everything that owns a resource pushes a teardown onto a LIFO stack, so `close()` (and a SIGINT)
 * leaves no `opencode serve`, SQLite handle or timer behind.
 */
import { arch, availableParallelism, cpus, hostname, platform, totalmem } from 'node:os';
import { createAuditor } from '@starling/auditor';
import type {
  AgentRunner,
  Clock,
  EventBus,
  LLM,
  NodeInfo,
  StarlingConfig,
  Store,
  Workspace,
} from '@starling/core';
import { createEventBus, StarlingError, systemClock } from '@starling/core';
import { NoopTracker } from '@starling/core/testing';
import { createEngine } from '@starling/engine';
import {
  createFlockHub,
  createLocalNode,
  createRegistry,
  createScheduler,
  type LocalNode,
} from '@starling/flock';
import { createGitHubTracker } from '@starling/github';
import { applyProfile, createLLM, type LLMProfileName, parseProfile } from '@starling/llm';
import { createMerger } from '@starling/merger';
import { createPlanner } from '@starling/planner';
import { createPromptCompiler } from '@starling/prompts';
import { createRepoMapper } from '@starling/repomap';
import { createOpencodeRunner } from '@starling/runner';
import { attachRecorder, createSqliteStore } from '@starling/store';
import { createWorkspace } from '@starling/workspace';
import type { Composition } from '../compose';
import { createDisposalStack } from './dispose';
import { createRecorderOwnedStore } from './engine-store';
import { startHubHeartbeat } from './hub-heartbeat';
import { storePathFor, worktreeRootFor } from './paths';
import { withDependencies } from './workspace-deps';

/**
 * Profile selection.
 *
 * `STARLING_LLM_PROFILE` wins, then the caller, then **`opencode`**: this machine has no DeepSeek API
 * key (L25/L29), so the honest default is "route everything through the opencode server we are about
 * to spawn". `--fully-open` asks for `local` instead; `starling plan/run` pass nothing.
 */
export const DEFAULT_REAL_PROFILE: LLMProfileName = 'opencode';

export interface ComposeRealOptions {
  /** The repo the run targets. Worktrees, the SQLite store and node_modules live relative to it. */
  repoPath: string;
  env?: Record<string, string | undefined>;
  clock?: Clock;
  bus?: EventBus;
  profile?: LLMProfileName;
  /** Per-run budget cap (`starling run --budget`). Overrides `budget.maxUsd`. */
  budgetUsd?: number;
  /** `--github`: mirror the plan onto issues/PRs. Needs an authenticated `gh`. */
  github?: boolean;
  hostName?: string;

  // ── seams for compose-real.test.ts. Production passes none of these. ──────────────────────────
  /** A scripted LLM (MockLLM) instead of real providers. */
  llm?: LLM;
  /** A pre-built runner (attached to the fake opencode server) instead of spawning one. */
  runner?: AgentRunner;
  /** Override the store (e.g. `:memory:`). */
  store?: Store;
  storePath?: string;
  worktreeRoot?: string;
}

export interface RealComposition extends Composition {
  flock: NonNullable<Composition['flock']>;
  store: Store;
  bus: EventBus;
  engine: Composition['engine'];
  profile: LLMProfileName;
  worktreeRoot: string;
  /** The `opencode serve` base URL agents and LLM completions both use. */
  runnerUrl: string;
  /** The hub's own node, for `info()` in commands (`starling status` does not need it). */
  hubNode: LocalNode;
  /** Point bundle URLs at the server that actually bound a port (perches fetch from there). */
  setHubUrl(url: string): void;
  close(): Promise<void>;
}

/** The `NodeInfo` the hub registers synchronously; the first heartbeat replaces it with real values. */
function hubInfo(id: string, name: string, maxSessions: number, clock: Clock): NodeInfo {
  return {
    id,
    name,
    kind: 'local',
    platform: platform(),
    arch: arch(),
    cpuCores: availableParallelism?.() ?? cpus().length,
    memGb: Math.round(totalmem() / 1024 ** 3),
    maxSessions,
    activeSessions: 0,
    localModels: [],
    status: 'online',
    lastSeen: clock.now(),
    latencyMs: 0,
  };
}

/** The opencode server password the runner and the LLM router share. */
function serverPassword(
  env: Record<string, string | undefined>,
  mode: 'spawn' | 'attach',
): string | undefined {
  const configured = env.OPENCODE_SERVER_PASSWORD;
  if (configured !== undefined && configured !== '') return configured;
  return mode === 'spawn' ? crypto.randomUUID() : undefined;
}

export function composeReal(config: StarlingConfig, options: ComposeRealOptions): RealComposition {
  const repoPath = options.repoPath;
  if (repoPath.trim() === '') {
    throw new StarlingError('INVALID_ARGUMENT', 'composeReal needs a repoPath');
  }
  const env = options.env ?? process.env;
  const clock = options.clock ?? systemClock;
  const bus = options.bus ?? createEventBus();
  // `parseProfile(undefined)` answers the *library* default (`deepseek`), so the env var is checked
  // first: on this machine there is no DeepSeek key and the honest default is `opencode`.
  const profile =
    options.profile ??
    (env.STARLING_LLM_PROFILE === undefined || env.STARLING_LLM_PROFILE === ''
      ? DEFAULT_REAL_PROFILE
      : parseProfile(env.STARLING_LLM_PROFILE));
  const dispose = createDisposalStack();
  const worktreeRoot = options.worktreeRoot ?? worktreeRootFor(repoPath, config.worktreeRoot);

  // ── 1. the opencode server (and the runner that owns it) ─────────────────────────────────────
  const password = serverPassword(env, config.opencode.mode);
  const runner =
    options.runner ??
    createOpencodeRunner({
      mode: config.opencode.mode,
      // Spawn mode owns a *private* server on a free port: pinning `config.opencode.port` would
      // collide with the user's own `opencode serve` (there is usually one on 4096), so the
      // configured port is only meaningful for attach mode and for `starling doctor`.
      ...(config.opencode.mode === 'attach' && config.opencode.url !== null && config.opencode.url !== ''
        ? { url: config.opencode.url }
        : {}),
      ...(password === undefined ? {} : { password }),
      bus,
    });
  if (options.runner === undefined) {
    dispose.push('opencode runner', () => runner.close());
  }
  const runnerUrl = 'url' in runner && typeof runner.url === 'function' ? runner.url() : '';

  // ── 2. config: profile, then the server we actually started ──────────────────────────────────
  let effective = applyProfile(config, profile);
  if (profile === 'opencode') {
    const provider = effective.providers.opencode;
    if (provider !== undefined) {
      effective = {
        ...effective,
        providers: {
          ...effective.providers,
          opencode: {
            baseUrl: runnerUrl === '' ? provider.baseUrl : runnerUrl,
            ...(password === undefined ? {} : { apiKeyEnv: 'OPENCODE_SERVER_PASSWORD' }),
          },
        },
      };
    }
  }
  const llmEnv: Record<string, string | undefined> =
    password === undefined ? { ...env } : { ...env, OPENCODE_SERVER_PASSWORD: password };

  // ── 3. store + recorder ──────────────────────────────────────────────────────────────────────
  const storePath = options.storePath ?? storePathFor(repoPath);
  const sqlite = options.store === undefined ? createSqliteStore(storePath) : undefined;
  const store = options.store ?? sqlite;
  if (store === undefined) throw new StarlingError('STORE_ERROR', 'no store could be built');
  if (sqlite !== undefined) dispose.push('sqlite store', () => sqlite.close());
  const detachRecorder = attachRecorder(bus, store);
  dispose.push('event recorder', () => detachRecorder());

  // ── 4. the ports the engine talks to ─────────────────────────────────────────────────────────
  const llm = options.llm ?? createLLM(effective, { env: llmEnv, bus });
  const repoMapper = createRepoMapper({ llm, clock });
  const planner = createPlanner({ llm, clock });
  const prompts = createPromptCompiler();
  const workspace: Workspace = withDependencies(createWorkspace({ worktreeRoot, clock }));
  const auditor = createAuditor({ llm, clock });
  const merger = createMerger({ worktreeRoot, clock });
  dispose.push('merger worktrees', () => merger.dispose());

  // ── 5. the flock: this machine's node, the registry, the hub ─────────────────────────────────
  const registry = createRegistry({ clock, offlineAfterMs: config.flock.offlineAfterMs });
  dispose.push('registry', () => registry.close());

  const hubName = options.hostName ?? hostname();
  const node = createLocalNode({
    id: 'hub',
    name: hubName,
    workspace,
    runner,
    maxSessions: config.flock.hubMaxSessions,
    worktreeRoot,
    clock,
  });
  dispose.push('local node', () => node.close());
  registry.add(node, hubInfo(node.id, hubName, config.flock.hubMaxSessions, clock));
  const heartbeat = startHubHeartbeat({
    node,
    registry,
    clock,
    everyMs: config.flock.heartbeatMs,
    onError: (err) => {
      bus.publish({
        type: 'log',
        runId: '*',
        ts: clock.now(),
        payload: {
          level: 'debug',
          msg: `hub heartbeat failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    },
  });
  dispose.push('hub heartbeat', () => heartbeat.stop());

  let hubUrl = `http://localhost:${config.server.port}`;
  const flock = createFlockHub({
    registry,
    hubUrl,
    bundleDir: `${worktreeRoot}/_bundles`,
    clock,
  });
  flock.setActiveRepo(repoPath);
  dispose.push('flock hub', () => flock.close());
  const joinCode = flock.code;

  // ── 6. the engine ───────────────────────────────────────────────────────────────────────────
  const github = options.github ?? config.github.enabled;
  const tracker = github
    ? createGitHubTracker({
        cwd: repoPath,
        ...(config.github.repo === null ? {} : { repo: config.github.repo }),
      })
    : new NoopTracker();

  const engineConfig: StarlingConfig = {
    ...effective,
    ...(options.budgetUsd === undefined
      ? {}
      : { budget: { ...effective.budget, maxUsd: options.budgetUsd } }),
  };

  const engine = createEngine({
    config: engineConfig,
    bus,
    store: createRecorderOwnedStore(store),
    clock,
    repoMapper,
    planner,
    prompts,
    workspace,
    registry,
    scheduler: createScheduler({ hubId: 'hub' }),
    auditor,
    merger,
    tracker,
    writer: llm,
    // A remote node fetches the integration branch from the hub's server, never from a file path.
    bundleUrlFor: (ref) => ({
      url: `${hubUrl}/api/flock/bundle?ref=${encodeURIComponent(ref)}`,
      token: joinCode,
    }),
  });

  return {
    engine,
    flock,
    store,
    bus,
    profile,
    worktreeRoot,
    runnerUrl,
    hubNode: node,
    setHubUrl(url: string) {
      hubUrl = url.replace(/\/+$/, '');
    },
    async close() {
      const failures = await dispose.run();
      if (failures.length > 0) {
        bus.publish({
          type: 'log',
          runId: '*',
          ts: clock.now(),
          payload: { level: 'warn', msg: `disposal problems: ${failures.join('; ')}` },
        });
      }
    },
  };
}
