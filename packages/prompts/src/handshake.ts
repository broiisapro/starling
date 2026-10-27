/**
 * The worker handback block (ARCHITECTURE §8). The shape moved into `@starling/core` at checkpoint
 * C1; this file keeps the runtime half — the zod schema and the markers — plus a re-export of the
 * type, so nothing downstream changes.
 */
import type { WorkerHandback } from '@starling/core';
import { z } from 'zod';

export type { WorkerHandback };

/**
 * Runtime validator for what a worker prints. Extra keys are ignored rather than rejected: a
 * chatty model that adds `"durationMin"` should not lose an otherwise valid handback.
 *
 * Declared against the core type so the two cannot drift: if `WorkerHandback` gains a required
 * field, this schema stops type-checking until it is taught the same field.
 */
export const WorkerHandbackSchema: z.ZodType<WorkerHandback> = z.object({
  status: z.enum(['complete', 'partial']),
  summary: z.string(),
  filesChanged: z.array(z.string()),
  testsAdded: z.array(z.string()),
  notes: z.string().optional(),
});

/** Opening marker of the handback block, verbatim from ARCHITECTURE §8. */
export const HANDBACK_START = '<<<STARLING_HANDBACK';

/** Closing marker of the handback block, verbatim from ARCHITECTURE §8. */
export const HANDBACK_END = 'STARLING_HANDBACK>>>';
