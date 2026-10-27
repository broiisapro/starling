import { StarlingError } from '@starling/core';

/** `full` is the default voice; `compact` strips prose and shortens the repo map for fast models. */
export type PromptStyle = 'full' | 'compact';

export interface PromptCompilerOptions {
  /** Character budget for the rendered repo map, before the overall prompt budget applies. */
  maxRepoMapChars?: number;
  /** Prose density. `compact` keeps every fact but drops the explanations around it. */
  style?: PromptStyle;
  /** Hard ceiling for a worker prompt. Only the repo map and sibling list are shrunk to fit. */
  maxChars?: number;
  /**
   * Optional overall token budget (`estimateTokens`, ~4 chars per token). When set, the least
   * important sections are trimmed first; the task, lane and finish line never are. Unset means
   * only the per-section ceilings in `DEFAULT_SECTION_BUDGETS` apply.
   */
  budgetTokens?: number;
}

export interface ResolvedPromptOptions {
  maxRepoMapChars: number;
  maxChars: number;
  style: PromptStyle;
  /** Fraction of `maxRepoMapChars` the style is allowed to use. */
  mapShare: number;
  /** Overall token budget, when the caller asked for one. */
  budgetTokens?: number;
}

/** 24k characters ≈ 6k tokens, small enough for a fast model to read in one pass. */
export const DEFAULT_MAX_CHARS = 24_000;

/** The repo map is orientation, not the task: 6k characters is plenty for a lane-focused view. */
export const DEFAULT_MAX_REPO_MAP_CHARS = 6_000;

/** Compact prompts trade explanations for tokens; facts (globs, DoD, handback) are never dropped. */
const MAP_SHARE: Record<PromptStyle, number> = { full: 1, compact: 0.4 };

export function resolveOptions(options: PromptCompilerOptions = {}): ResolvedPromptOptions {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxRepoMapChars = options.maxRepoMapChars ?? DEFAULT_MAX_REPO_MAP_CHARS;
  const style = options.style ?? 'full';
  const budgetTokens = options.budgetTokens;

  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    throw new StarlingError('INVALID_ARGUMENT', 'maxChars must be a positive number', {
      details: { maxChars },
    });
  }
  if (!Number.isFinite(maxRepoMapChars) || maxRepoMapChars <= 0) {
    throw new StarlingError('INVALID_ARGUMENT', 'maxRepoMapChars must be a positive number', {
      details: { maxRepoMapChars },
    });
  }
  if (style !== 'full' && style !== 'compact') {
    throw new StarlingError('INVALID_ARGUMENT', `unknown prompt style: ${String(style)}`, {
      details: { style },
    });
  }
  if (budgetTokens !== undefined && (!Number.isFinite(budgetTokens) || budgetTokens <= 0)) {
    throw new StarlingError('INVALID_ARGUMENT', 'budgetTokens must be a positive number', {
      details: { budgetTokens },
    });
  }

  return {
    maxChars,
    maxRepoMapChars,
    style,
    mapShare: MAP_SHARE[style],
    ...(budgetTokens === undefined ? {} : { budgetTokens }),
  };
}
