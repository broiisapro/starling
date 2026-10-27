/**
 * The §8 handshake moved into `@starling/core` at checkpoint C1 (`packages/core/src/handshake.ts`).
 *
 * This file stays as a one-line re-export so every existing import (`import type { JoinInfo } from
 * './handshake'`) keeps working, and flock's public surface is unchanged.
 */
export type {
  AgentDrawerProps,
  BundleUrlFor,
  DagViewProps,
  EngineApi,
  FlockHub,
  FlockPanelProps,
  JoinInfo,
  MergeQueueProps,
  MetricsPanelProps,
  SkyViewProps,
  StartRunInput,
  WorkerHandback,
} from '@starling/core';
