import { z } from '../lib/zod';

/**
 * One expected feature of the goal. `keywords` is an AND of ORs: every group must match somewhere
 * in a task's key/title/goal/deliverables, and within a group any one alternative is enough.
 *
 * Example: `[["dark mode", "dark theme"], ["toggle", "switch"]]` matches a task whose text mentions
 * a dark theme *and* a toggle/switch.
 */
export const FeatureSpecSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  keywords: z.array(z.array(z.string().min(1)).min(1)).min(1),
});

export const PlannerCaseSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case name'),
  goal: z.string().min(1),
  /** RepoMap path relative to the repo root. */
  repomap: z.string().min(1),
  taskCount: z
    .object({ min: z.number().int().positive(), max: z.number().int().positive() })
    .refine((range) => range.max >= range.min, 'taskCount.max must be >= taskCount.min'),
  features: z.array(FeatureSpecSchema).min(1),
  /** `[dependencyFeature, dependentFeature]`: the dependent feature's task must directly depend on it. */
  requiredDeps: z.array(z.tuple([z.string(), z.string()])).default([]),
  /** Concrete paths that some task's `lane.owns` must cover. New files are fine. */
  requiredLaneFiles: z.array(z.string().min(1)).min(1),
  /** Concrete paths that no task may own (shared files, manifests, lockfiles). */
  forbiddenFiles: z.array(z.string().min(1)).default([]),
  /**
   * Accepted exact sets of error-level validator codes. The default `[[]]` means "validator must
   * report no errors". `conflict-bait` accepts either a clean repair or the deliberate overlap.
   */
  validator: z.object({ anyOf: z.array(z.array(z.string().min(1))).min(1) }).default({ anyOf: [[]] }),
  notes: z.string().optional(),
});

export type FeatureSpec = z.infer<typeof FeatureSpecSchema>;
export type PlannerCase = z.infer<typeof PlannerCaseSchema>;
