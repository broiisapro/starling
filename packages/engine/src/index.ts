/**
 * `@starling/engine` — the orchestration state machine (ARCHITECTURE §4).
 *
 * Talks only to the ports in `@starling/core`, so it runs unchanged on core's test doubles.
 */
export * from './agent-event';
export * from './engine';
export * from './handshake';
export * from './metrics';
export * from './nodes';
export * from './policies/budget';
export * from './policies/log';
export * from './policies/parallelism';
export * from './policies/rate-limit';
export * from './policies/stall';
export * from './run-driver';
export * from './run-status';
export * from './state';
export * from './summary';
export * from './transitions';
export * from './types';

export const PACKAGE = '@starling/engine' as const;
