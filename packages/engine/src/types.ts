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
  /** Robustness knobs; every field is optional and has a documented default (Epic 49). */
  policies?: EnginePolicies;
  /**
   * Where a task branch's worktree lives, so `cancel()` can remove it while keeping the branch.
   *
   * The engine never creates worktrees (the ExecutionNode does). A host that knows the layout
   * injects this; a node that reports `handle.worktreePath` is used first. Without either, cancel
   * still leaves the store consistent and only skips the filesystem cleanup.
   */
  worktreePathFor?: (branch: string) => string;
}

/** Every policy is opt-in with a safe default; `0` disables the stall watchdog. */
export interface EnginePolicies {
  /** No agent event for this long means the session stalled. Default: config `stallAfterMs`, else 4 min. */
  stallAfterMs?: number;
  /** Recoveries per dispatch before failing. Default 1 ("resend the prompt once"). */
  maxStallRetries?: number;
  /** Hard cap; defaults to `config.budget.maxUsd`, and `StartRunInput.budgetUsd` wins when present. */
  budgetUsd?: number;
  /** Early-warning fraction of the cap. Default 0.8. */
  budgetWarnRatio?: number;
  /** Quiet window after a rate limit before effective parallelism may grow again. Default 60 s. */
  rateLimitRecoverMs?: number;
}
