/** Public types for the engine. `EngineApi` lives in the §8 handshake mirror. */
import type {
  Auditor,
  Clock,
  EventBus,
  LLM,
  Merger,
  NodeRegistry,
  Planner,
  PromptCompiler,
  RepoMapper,
  Scheduler,
  StarlingConfig,
  Store,
  Tracker,
  Workspace,
} from '@starling/core';
import type { BundleUrlFor } from './handshake';
import type { Timers } from './metrics';

/**
 * Everything the engine needs, injected. Every field is a port, so the whole state machine can run
 * on `@starling/core/testing` doubles.
 *
 * `strictTransitions` and `timers` are additive (not in the Wave 1 handshake): strict mode makes an
 * illegal edge throw, and injectable timers keep the 5 s metrics heartbeat deterministic in tests.
 */
export interface EngineDeps {
  config: StarlingConfig;
  bus: EventBus;
  store: Store;
  clock: Clock;
  repoMapper: RepoMapper;
  planner: Planner;
  prompts: PromptCompiler;
  workspace: Workspace;
  registry: NodeRegistry;
  scheduler: Scheduler;
  auditor: Auditor;
  merger: Merger;
  tracker: Tracker;
  bundleUrlFor?: BundleUrlFor;
  writer?: LLM;
  strictTransitions?: boolean;
  timers?: Timers;
}
