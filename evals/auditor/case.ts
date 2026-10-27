import { DiffSummarySchema, TaskSpecSchema } from '../lib/core';
import { z } from '../lib/zod';

export const AuditorExpectationSchema = z.object({
  pass: z.boolean(),
  /** Paths the verdict must list as lane violations. */
  laneViolations: z.array(z.string().min(1)).default([]),
  /** Check names the reference verdict marks `ok: false`. */
  failingChecks: z.array(z.string().min(1)).default([]),
  /** AND of ORs that a useful fix instruction must mention. */
  mustMention: z.array(z.array(z.string().min(1)).min(1)).default([]),
  /** The reference fix text. Required for fail cases; every `mustMention` group must hit it. */
  referenceFix: z.string().min(1).optional(),
  rationale: z.string().min(1),
});

export const AuditorCaseSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case name'),
  title: z.string().min(1),
  task: TaskSpecSchema,
  diff: DiffSummarySchema,
  changedFiles: z.array(z.string().min(1)),
  expected: AuditorExpectationSchema,
});

export type AuditorExpectation = z.infer<typeof AuditorExpectationSchema>;
export type AuditorCase = z.infer<typeof AuditorCaseSchema>;
