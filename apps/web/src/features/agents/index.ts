/** Feature lane id — kept for the Wave 0 feature-folder smoke test. */
export const FEATURE = 'agents' as const;

/**
 * The agent drawer feature lane.
 *
 * Props-only per ARCHITECTURE §8: the shell (Epic 23) passes the selected task's events, verdicts and
 * diff. Nothing here fetches, edits or writes.
 */
export { AgentDrawer } from './AgentDrawer';
export type { AgentDrawerProps } from './handshake';
