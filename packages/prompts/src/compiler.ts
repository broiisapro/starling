import type { MergeResult, PromptCompiler, PromptContext } from '@starling/core';
import { buildFixerPrompt } from './fixer-prompt';
import { type PromptCompilerOptions, resolveOptions } from './options';
import { buildResolverPrompt, type ResolverPromptExtras } from './resolver-prompt';
import { buildWorkerPrompt } from './worker-prompt';

/**
 * The compiler, plus the resolver's optional third argument.
 *
 * `PromptCompiler` (core, LOCKED) types `resolver(ctx, conflict)`. Adding an *optional* third
 * parameter keeps this a `PromptCompiler` — a plain two-argument implementation is still assignable
 * — while letting the merger hand over the trimmed conflict hunks it captured. Callers that only
 * know the port keep working unchanged.
 */
export interface ResolverPromptCompiler extends PromptCompiler {
  resolver(ctx: PromptContext, conflict: MergeResult, extras?: ResolverPromptExtras): string;
}

/**
 * Create the deterministic prompt compiler.
 *
 * Options are validated once, at construction, so a bad `maxChars` fails at wiring time rather
 * than mid-run. Every method is pure: same context, same string, no clock and no randomness.
 */
export function createPromptCompiler(options: PromptCompilerOptions = {}): ResolverPromptCompiler {
  const resolved = resolveOptions(options);
  return {
    worker: (ctx) => buildWorkerPrompt(ctx, resolved),
    fixer: (ctx, verdict) => buildFixerPrompt(ctx, verdict, resolved),
    resolver: (ctx, conflict, extras = {}) => buildResolverPrompt(ctx, conflict, resolved, extras),
  };
}
