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

/**
 * The recorded outcome of the repo's suite for this case, used to build a real worktree for
 * `--impl real` (see `worktree.ts`). A default green suite is the common case; a case whose story is
 * "the tests are red" records the failing assertion so Bun prints genuine output.
 */
export const AuditorSuiteSchema = z.object({
  pass: z.boolean().default(true),
  testName: z.string().min(1).default('recorded suite'),
  /** Received value of the failing assertion (only used when `pass` is false). */
  actual: z.string().default('ok'),
  /** Expected value of the failing assertion (only used when `pass` is false). */
  expected: z.string().default('ok'),
});

export const AuditorCaseSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case name'),
  title: z.string().min(1),
  task: TaskSpecSchema,
  diff: DiffSummarySchema,
  changedFiles: z.array(z.string().min(1)),
  expected: AuditorExpectationSchema,
  suite: AuditorSuiteSchema.default({ pass: true, testName: 'recorded suite', actual: 'ok', expected: 'ok' }),
  /**
   * Added before tuning and never used to tune the prompt: these cases are the generalisation check
   * and are reported separately from the twelve seeded ones (Epic 44).
   */
  heldOut: z.boolean().default(false),
});

export type AuditorExpectation = z.infer<typeof AuditorExpectationSchema>;
export type AuditorSuite = z.infer<typeof AuditorSuiteSchema>;
export type AuditorCase = z.infer<typeof AuditorCaseSchema>;
