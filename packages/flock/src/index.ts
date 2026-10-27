/**
 * `@starling/flock` — the distributed heart of Starling.
 *
 * `LocalNode` runs agents on this machine (hub or perch), `RemoteNode` drives a perch over the Perch
 * HTTP API, `createRegistry`/`createScheduler` track and place work across machines, `createFlockHub`
 * owns join codes, heartbeats, discovery and repo bundles, and `mdns` finds perches on the LAN.
 *
 * Flock mode in one line: bundles out, bundles back, audit and merge on the hub.
 */
export const PACKAGE = '@starling/flock' as const;

export * from './bundle-ops';
export type { BundleUrlFor, JoinInfo } from './handshake';
export * from './hub';
export * from './join-code';
export * from './local-node';
export * from './mdns';
export * from './registry';
export * from './remote-node';
export * from './scheduler';
