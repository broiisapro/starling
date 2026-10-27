/**
 * `@starling/core` — contracts, ports, event bus, config, ids, errors, exec, glob and metrics.
 *
 * Everything public is re-exported here. The test doubles live behind `@starling/core/testing`
 * so production bundles never pull them in.
 */
export const PACKAGE = '@starling/core' as const;

export * from './clock';
export * from './config';
export * from './contracts';
export * from './errors';
export * from './events';
export * from './exec';
export * from './glob';
export * from './handshake';
export * from './ids';
export * from './metrics';
export * from './ports';
