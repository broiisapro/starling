/**
 * `@starling/perch` — the daemon behind `starling perch`.
 *
 * It wraps a local `ExecutionNode` in the Perch HTTP API (ARCHITECTURE §6), advertises itself over
 * mDNS, registers with the hub using the flock join code, and heartbeats until stopped.
 */
export const PACKAGE = '@starling/perch' as const;

export * from './auth';
export * from './compose-perch';
export * from './event-log';
export * from './handshake';
export * from './join-code';
export * from './lan';
export * from './mdns';
export * from './perch-app';
export * from './perch-daemon';
export * from './perch-info';
