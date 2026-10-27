import type { MergeQueueProps } from './handshake';

/**
 * Additive props beyond ARCHITECTURE §8. `selectedTask` is the carry-over from C1: the shell already
 * selects a task everywhere else, and a queue card should highlight too. Declared as an
 * intersection so this compiles before and after core grows the field (Epic 40), and so
 * `MergeQueue` still satisfies the frozen `MergeQueueProps`.
 */
export interface QueueExtras {
  selectedTask?: string;
}

export type MergeQueueAllProps = MergeQueueProps & QueueExtras;
