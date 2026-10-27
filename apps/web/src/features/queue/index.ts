/** Feature lane: the merge queue board (Epic 26). */
export const FEATURE = 'queue' as const;

export type {
  QueueBoard,
  QueueCard,
  QueueColumnId,
  QueueColumnMeta,
  WaitingReason,
  WireEntry,
} from './columns';
export {
  assignColumn,
  buildQueueBoard,
  COLUMN_BY_STATUS,
  latestMergeResult,
  pendingRun,
  QUEUE_COLUMN_META,
  QUEUE_COLUMNS,
  taskElapsedMs,
  transitionOffset,
  unmetDependencies,
  waitingLabel,
  wireOrder,
} from './columns';
export type { MergeQueueProps } from './handshake';
export { MergeQueue } from './MergeQueue';
export { type TaskRunWithNodeName, taskNodeLabel } from './node-name';
export type { StatusStyle } from './palette';
export { NEUTRAL_CHIP, STATUS_STYLE } from './palette';
export type { QueueReplayState } from './replay';
export { replayQueue } from './replay';
export type { MergeQueueAllProps, QueueExtras } from './types';
export {
  type ColumnWindow,
  type ColumnWindowInput,
  columnWindow,
  QUEUE_ROW_HEIGHT,
  QUEUE_VIRTUALIZE_AFTER,
} from './window';
