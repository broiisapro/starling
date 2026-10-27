import type { PromptCompiler } from '@starling/core';
import { buildFixerPrompt } from './fixer-prompt';
import { type PromptCompilerOptions, resolveOptions } from './options';
import { buildResolverPrompt } from './resolver-prompt';
import { buildWorkerPrompt } from './worker-prompt';

/**
 * Create the deterministic prompt compiler.
 *
 * Options are validated once, at construction, so a bad `maxChars` fails at wiring time rather
 * than mid-run. Every method is pure: same context, same string, no clock and no randomness.
 */
export function createPromptCompiler(options: PromptCompilerOptions = {}): PromptCompiler {
  const resolved = resolveOptions(options);
  return {
    worker: (ctx) => buildWorkerPrompt(ctx, resolved),
    fixer: (ctx, verdict) => buildFixerPrompt(ctx, verdict, resolved),
    resolver: (ctx, conflict) => buildResolverPrompt(ctx, conflict, resolved),
  };
}
