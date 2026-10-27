/**
 * `@starling/github` — the `Tracker` port on GitHub, implemented with the `gh` CLI.
 *
 * In GitHub mode a Starling run mirrors itself onto the repo: one issue per task, a PR per task
 * branch carrying the audit verdict, and a final PR from the integration branch. The module is pure
 * rendering plus an injectable shell-out, so tests never touch the network (ARCHITECTURE L23).
 */
export const PACKAGE = '@starling/github' as const;

export * from './errors';
export * from './gh';
export * from './handshake';
export * from './render';
export * from './tracker';
