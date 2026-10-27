import { StartTaskOptionsSchema } from '@starling/core';
import { z } from 'zod';

/**
 * Boundary validation for the values a hub sends (SEC-10).
 *
 * A perch forwards `branch` and `fromRef` into `Workspace.create` → `git worktree add`, and git
 * accepts far more than a branch name (options, revision syntax, pathspec magic). Containment in the
 * workspace sanitiser is defence in depth; the boundary is where a hostile value must die with a
 * 400 before git is ever spawned.
 *
 * The two alphabets are deliberately narrow:
 *
 * - refs: `^[A-Za-z0-9._/-]{1,200}$` — no whitespace, no `~ ^ : ? * [ \`, so no revision or
 *   pathspec syntax can survive, and no shell metacharacter (a ref never reaches a shell: L13 uses
 *   argv form, but a narrow alphabet keeps that true by construction);
 * - ids (`runId`, `taskKey`, route params): `^[A-Za-z0-9._-]{1,128}$` — branch slashes are not part
 *   of an id, so `/` is rejected and a task key can never address two path segments.
 */

/** Longest ref the perch will forward. Matches SEC-03's hub-side limit. */
export const PERCH_REF_MAX_LENGTH = 200;
/** Longest `runId` / `taskKey` the perch will accept (body or route param). */
export const PERCH_ID_MAX_LENGTH = 128;

export const PERCH_REF_PATTERN = /^[A-Za-z0-9._/-]{1,200}$/;
export const PERCH_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export interface SafeRefOptions {
  /**
   * Reserved: reflog syntax (`HEAD@{1}`) is never accepted by this perch. The option exists so a
   * future caller can widen the alphabet deliberately instead of loosening `isSafeRef` for everyone.
   */
  allowReflog?: false;
}

/**
 * Is `ref` a value a perch may hand to git?
 *
 * Rules, in order: the character alphabet and length (which already excludes whitespace and every
 * character git's revision grammar treats specially), no leading `-` (an option, not a ref), no `..`
 * anywhere (git forbids it in a ref name, and it is the traversal primitive), no empty segment
 * (`//`, leading or trailing `/`), and no `@{` reflog syntax unless explicitly allowed.
 */
export function isSafeRef(ref: string, opts: SafeRefOptions = {}): boolean {
  if (!PERCH_REF_PATTERN.test(ref)) return false;
  if (ref.startsWith('-')) return false;
  if (ref.includes('..')) return false;
  if (ref.startsWith('/') || ref.endsWith('/') || ref.includes('//')) return false;
  // `allowReflog` is typed `false` (reflog syntax is never accepted); the cast keeps the runtime
  // guard honest for untyped callers instead of relying on the type alone.
  if ((opts as { allowReflog?: boolean }).allowReflog !== true && ref.includes('@{')) return false;
  return true;
}

/** Is `value` a legal `runId` / `taskKey` (body field or `:runId` / `:key` route param)? */
export function isSafeId(value: string): boolean {
  return PERCH_ID_PATTERN.test(value);
}

const refMessage = (field: 'branch' | 'fromRef' | 'baseRef'): string =>
  `${field} must match ${PERCH_REF_PATTERN.source}, must not start with "-" or contain ".."${field === 'branch' ? '' : ' or "@{"'}`;

const idMessage = (field: 'runId' | 'taskKey'): string =>
  `${field} must match ${PERCH_ID_PATTERN.source}`;

/**
 * `StartTaskOptions` plus the perch's boundary rules. A hostile `branch`, `fromRef`, `runId` or
 * `taskKey` fails here, so `node.startTask` is never reached (and git never sees the value).
 */
export const PerchStartTaskSchema = StartTaskOptionsSchema.superRefine((value, ctx) => {
  if (!isSafeRef(value.branch)) {
    ctx.addIssue({ code: 'custom', path: ['branch'], message: refMessage('branch') });
  }
  if (!isSafeRef(value.fromRef)) {
    ctx.addIssue({ code: 'custom', path: ['fromRef'], message: refMessage('fromRef') });
  }
  if (!isSafeId(value.runId)) {
    ctx.addIssue({ code: 'custom', path: ['runId'], message: idMessage('runId') });
  }
  if (!isSafeId(value.taskKey)) {
    ctx.addIssue({ code: 'custom', path: ['taskKey'], message: idMessage('taskKey') });
  }
});

export type PerchStartTask = z.infer<typeof PerchStartTaskSchema>;

/** Body of `POST …/prompt`. Size is bounded by the body limit, not here. */
export const PerchPromptSchema = z.object({ prompt: z.string().min(1) });

/** Body of `POST …/collect`: `baseRef` is a ref that ends up in a git command, so it is validated. */
export const PerchCollectSchema = z.object({
  baseRef: z
    .string()
    .min(1)
    .refine((value) => isSafeRef(value), { message: refMessage('baseRef') }),
});
