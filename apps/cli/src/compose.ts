import type { EventBus, StarlingConfig, StarlingErrorCode, Store } from '@starling/core';
import { createEventBus, StarlingError } from '@starling/core';
import { MemoryStore } from '@starling/core/testing';
import type { EngineApi, FlockHub } from './handshake';
import { MockEngine } from './mock-engine';
import { createMockFlockHub } from './mock-flock';

export interface ComposeOptions {
  /** Wave 1 implements `mock` only; `real` throws until Epic 40 wires the siblings. */
  mode: 'mock' | 'real';
  /** Mock engine transition latency. The CLI uses motion; tests use 0. */
  stepMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Composition {
  engine: EngineApi;
  flock?: FlockHub;
  store: Store;
  bus: EventBus;
}

/**
 * The composition root.
 *
 * Every command resolves its engine, flock, store and bus here, never by importing a sibling
 * package. `mock` is built entirely from `@starling/core/testing`, so the CLI is runnable today;
 * `real` becomes a one-line switch in Epic 40.
 */
export function compose(config: StarlingConfig, options: ComposeOptions): Composition {
  if (options.mode === 'real') {
    // The StarlingError code union has no NOT_WIRED yet — see the CONTRACT REQUEST in the handback.
    throw new StarlingError(
      NOT_WIRED,
      'real wiring lands in epic 40 — run with the mock composition for now',
      {
        details: { mode: options.mode },
      },
    );
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

/** See the CONTRACT REQUEST in `.orchestrator/handbacks/22-cli.md`. */
const NOT_WIRED = 'NOT_WIRED' as StarlingErrorCode;
