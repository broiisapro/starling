/** Feature lane id — kept for the Wave 0 feature-folder smoke test. */
export const FEATURE = 'dag' as const;

/**
 * The task DAG feature lane.
 *
 * `DagView` takes plain props (core types only) and never reads the global store — the shell (Epic 23)
 * wires store → props. See ARCHITECTURE §8 and `handshake.ts`.
 */
export { type CriticalPath, criticalEdges, criticalKeys, criticalPath } from './critical-path';
export { DagView } from './DagView';
export { activeKeys, followTarget } from './follow';
export {
  elapsedFor,
  formatElapsed,
  nodeLabel,
  nodeNameOf,
  shortTitle,
  type TaskRunWithNodeName,
} from './format';
export type { DagViewProps } from './handshake';
export { STATUS_META, type StatusMeta, statusMeta } from './status';
export type { DagViewAllProps, DagViewExtras } from './types';
export { STATUS_FLASH_MS, useStatusFlash } from './use-status-flash';
