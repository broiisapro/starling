/**
 * The LLM-facing plan shape. Deliberately narrower than `Plan`: the model only supplies the parts
 * that need judgement (summary, repo-wide facts, tasks). Starling itself mints ids, attaches the
 * goal id, records the model that answered and stamps the clock, so a model can never fake those.
 *
 * `TaskSpecSchema` is reused verbatim from core so the draft and the contract cannot drift.
 */
import { PlanSchema, TaskSpecSchema } from '@starling/core';
import { z } from 'zod';

export const PlanDraftSchema = z.object({
  summary: z.string(),
  lockedDecisions: z.array(z.string()),
  tasks: z.array(TaskSpecSchema),
});
export type PlanDraft = z.infer<typeof PlanDraftSchema>;

/** Used by tests and evals to prove a built plan still satisfies the frozen contract. */
export const BuiltPlanSchema = PlanSchema;
