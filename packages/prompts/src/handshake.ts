// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
//
// Only the block this package produces and parses is mirrored here. The rest of §8 (EngineApi,
// FlockHub, the web feature props) belongs to other packages and lands in core at C1 with the
// other mirrors. Until then this file is the single source of truth for the worker handback
// shape, and the zod schema below is the runtime half of the same contract.
import { z } from 'zod';

export interface WorkerHandback {
  status: 'complete' | 'partial';
  summary: string;
  filesChanged: string[];
  testsAdded: string[];
  notes?: string;
}

/**
 * Runtime validator for what a worker prints. Extra keys are ignored rather than rejected: a
 * chatty model that adds `"durationMin"` should not lose an otherwise valid handback.
 */
export const WorkerHandbackSchema = z.object({
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
