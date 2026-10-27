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
export * from './run-driver';
export * from './state';
export * from './summary';
export * from './transitions';
export * from './types';

export const PACKAGE = '@starling/engine' as const;
