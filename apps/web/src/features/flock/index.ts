/**
 * `features/flock` — the dashboard's flock panel: every machine in the swarm, plus the on-ramp for
 * the next one. Props-only; the shell (Epic 23 / C1) owns the store and passes `FlockPanelProps`.
 *
 * Public surface:
 * - `FlockPanel` (ARCHITECTURE §8) and its local additions (`compact`, `reducedMotion`, `now`, `onSelectTask`)
 * - `Playground` — fixture-driven demo of the Air joining and dropping
 * - pure helpers (`deriveNodes`, `deriveTasks`, `sortRoosts`, `relativeTime`) for the C1 store
 */
export const FEATURE = 'flock' as const;

export { deriveNodes, deriveTasks } from './derive-nodes';
export { FlockPanel } from './FlockPanel';
export { isHub, relativeTime, sessionTotals, sortRoosts } from './format';
export type { FlockPanelProps, JoinInfo } from './handshake';
export { PLAYGROUND_JOIN, Playground, parseEventLog } from './Playground';
export { STATUS_PALETTE } from './palette';
export { qrMatrix } from './QrCode';
export type { FlockPanelAllProps, FlockPanelExtras } from './types';
