/** Feature lane id — kept for the Wave 0 feature-folder smoke test. */
export const FEATURE = 'dag' as const;

/**
 * The task DAG feature lane.
 *
 * `DagView` takes plain props (core types only) and never reads the global store — the shell (Epic 23)
 * wires store → props. See ARCHITECTURE §8 and `handshake.ts`.
 */
export { DagView } from './DagView';
export type { DagViewProps } from './handshake';
