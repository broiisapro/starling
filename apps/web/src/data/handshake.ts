/**
 * The §8 handshake moved into `@starling/core` at checkpoint C1 (`packages/core/src/handshake.ts`).
 *
 * This file stays as a one-line re-export so every existing import keeps working. When Epic 34
 * switches the web imports over, point them at `@starling/core/browser` instead.
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
