import type { EventBus, StarlingConfig, Store } from '@starling/core';
import { createEventBus, StarlingError } from '@starling/core';
import { MemoryStore } from '@starling/core/testing';
import type { LLMProfileName } from '@starling/llm';
import type { EngineApi, FlockHub } from './handshake';
import { MockEngine } from './mock-engine';
import { createMockFlockHub } from './mock-flock';
import { composeReal } from './real/compose-real';

export interface ComposeOptions {
  /** `real` builds every package; `mock` is the Wave 1 demo/test stack from core's doubles. */
  mode: 'mock' | 'real';
  /** Mock engine transition latency. The CLI uses motion; tests use 0. */
  stepMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;

  // ── real mode ───────────────────────────────────────────────────────────────────────────────
  /** The repo the command resolved (`--repo`). Worktrees and the SQLite store live relative to it. */
  repoPath?: string;
  /** The config to build from — commands pass the effective one after `--budget`/`--github`. */
  config?: StarlingConfig;
  budgetUsd?: number;
  github?: boolean;
  profile?: LLMProfileName;
  env?: Record<string, string | undefined>;
}

export interface Composition {
  engine: EngineApi;
  flock?: FlockHub;
  store: Store;
  bus: EventBus;
  /** Real composition only: stop the opencode server, timers, the store. Safe to call twice. */
  close?(): Promise<void>;
  /**
   * Real composition only: point the hub's bundle URLs at the server that actually bound a port.
   * `starling run` starts the dashboard after the engine exists, so the URL is known later.
   */
  setHubUrl?(url: string): void;
}

/**
 * The composition root.
 *
 * Every command resolves its engine, flock, store and bus here, never by importing a sibling
 * package. `mock` is built entirely from `@starling/core/testing` (no processes, no network);
 * `real` wires `./real/compose-real` (one `opencode serve`, SQLite, the flock hub and the engine).
 */
export function compose(config: StarlingConfig, options: ComposeOptions): Composition {
  if (options.mode === 'real') {
    if (options.repoPath === undefined || options.repoPath.trim() === '') {
      throw new StarlingError(
        'INVALID_ARGUMENT',
        'The real composition needs a repo — pass --repo <path> or run inside the target repo',
        { details: { mode: options.mode } },
      );
    }
    return composeReal(options.config ?? config, {
      repoPath: options.repoPath,
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.now === undefined ? {} : { clock: { now: options.now } }),
      ...(options.budgetUsd === undefined ? {} : { budgetUsd: options.budgetUsd }),
      ...(options.github === undefined ? {} : { github: options.github }),
      ...(options.profile === undefined ? {} : { profile: options.profile }),
    });
  }

  const now = options.now ?? (() => Date.now());
  const store = new MemoryStore();
  const bus = createEventBus();
  const engine = new MockEngine({
    store,
    bus,
    models: { worker: config.models.worker, auditor: config.models.auditor },
    maxParallel: config.maxParallel,
    baseBranch: config.baseBranch,
    flockEnabled: config.flock.enabled,
    stepMs: options.stepMs ?? 55,
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    now,
  });
  const flock = createMockFlockHub(config, { now });

  return { engine, flock, store, bus };
}
