/**
 * Section budgets: keep a prompt predictable when one section is enormous.
 *
 * A prompt is assembled from named sections. Each section has a default token ceiling, so a giant
 * test log in the fixer cannot push the task spec out of the window, and an optional overall budget
 * trims the least important sections first when the whole prompt is still too long.
 *
 * Two promises make this safe to adopt:
 * - The task, lane and finish line are **never** truncated. An incomplete task spec is worse than a
 *   long prompt; the report says when the fixed sections alone exceed the budget.
 * - Truncation is deterministic and visible. The cut is marked with
 *   `[… N chars trimmed to fit the prompt budget]`, so a model (and a reviewer) knows text was lost.
 */
import { StarlingError } from '@starling/core';
import { joinSections } from './text';
import { estimateTokens } from './tokens';

/** Every section a worker, fixer or resolver prompt can contain. */
export type SectionId =
  | 'role'
  | 'project'
  | 'task'
  | 'lane'
  | 'siblings'
  | 'orientation'
  | 'verification'
  | 'git'
  | 'finish'
  | 'fix-detail';

export interface SectionInput {
  id: SectionId;
  text: string;
  /** Lower numbers are trimmed first when the overall budget is exceeded. */
  priority: number;
  /** Never truncated, whatever the id or priority. */
  required?: boolean;
}

export interface SectionReport {
  id: SectionId;
  /** Estimated tokens after capping and trimming. */
  tokens: number;
  truncated: boolean;
}

export interface FitSectionsResult {
  text: string;
  report: SectionReport[];
}

/**
 * Per-section ceilings, in estimated tokens (`estimateTokens`, ~4 characters per token).
 *
 * Generous on purpose: an ordinary prompt never hits them, so adopting budgets does not change the
 * prompt a model already reads. They exist for the outlier — a 200-line test tail, a 300-task plan's
 * sibling list, a hostile README summary.
 */
export const DEFAULT_SECTION_BUDGETS: Record<SectionId, number> = {
  role: 160,
  project: 560,
  task: 1_000,
  lane: 400,
  siblings: 500,
  orientation: 1_800,
  verification: 560,
  git: 240,
  finish: 340,
  'fix-detail': 1_600,
};

/** Task, lane and finish line are product promises, not preferences. */
const PROTECTED_SECTIONS: ReadonlySet<SectionId> = new Set(['task', 'lane', 'finish']);

const CHARS_PER_TOKEN = 4;

/** The exact, greppable mark a truncated section carries. */
export function trimMarker(chars: number): string {
  return `[… ${chars} chars trimmed to fit the prompt budget]`;
}

function isProtected(section: SectionInput): boolean {
  return section.required === true || PROTECTED_SECTIONS.has(section.id);
}

interface Cut {
  text: string;
  trimmed: boolean;
}

/**
 * Cut `text` to at most `maxTokens`, ending with the marker. Returns the empty string when the
 * budget is too small even for a marker: a section that cannot say anything useful is dropped.
 *
 * The marker's digit count changes with the amount removed, so the cut is solved iteratively (at
 * most five rounds, then a hard cut). Deterministic: no clock, no randomness.
 */
function cutToTokens(text: string, maxTokens: number): Cut {
  const maxChars = Math.max(0, Math.floor(maxTokens * CHARS_PER_TOKEN));
  if (text.length <= maxChars) return { text, trimmed: false };
  if (maxChars === 0) return { text: '', trimmed: true };

  let marker = trimMarker(text.length);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const keep = maxChars - marker.length - 2;
    if (keep <= 0) return { text: '', trimmed: true };
    const head = text.slice(0, keep).trimEnd();
    const removed = text.length - head.length;
    marker = trimMarker(removed);
    const candidate = `${head}\n\n${marker}`;
    if (candidate.length <= maxChars) return { text: candidate, trimmed: true };
  }
  return { text: text.slice(0, maxChars), trimmed: true };
}

interface CappedSection {
  section: SectionInput;
  cut: Cut;
}

function assemble(capped: CappedSection[], select: (capped: CappedSection) => string): string {
  return joinSections(capped.map(select));
}

function reportFor(capped: CappedSection[]): SectionReport[] {
  return capped.map(({ section, cut }) => ({
    id: section.id,
    tokens: estimateTokens(cut.text),
    truncated: cut.trimmed,
  }));
}

/**
 * Apply only the per-section ceilings. This is what the compiler runs when the caller has not asked
 * for an overall token budget: normal sections are untouched, outliers are cut and marked.
 */
export function capSections(
  sections: SectionInput[],
  budgets: Record<SectionId, number> = DEFAULT_SECTION_BUDGETS,
): FitSectionsResult {
  const capped = capEntries(sections, budgets);
  return {
    text: assemble(capped, ({ cut }) => cut.text),
    report: reportFor(capped),
  };
}

function capEntries(
  sections: SectionInput[],
  budgets: Record<SectionId, number> = DEFAULT_SECTION_BUDGETS,
): CappedSection[] {
  return sections.map((section) => {
    if (isProtected(section)) return { section, cut: { text: section.text, trimmed: false } };
    return { section, cut: cutToTokens(section.text, budgets[section.id]) };
  });
}

/**
 * Fit the sections into `totalTokens`.
 *
 * Per-section ceilings apply first. If the total is still over, sections are emptied/trimmed in
 * ascending `priority` (lowest first), then by their original order as a stable tie-break. The text
 * is always returned in the caller's original order; only budgets change. If the protected sections
 * alone exceed `totalTokens`, the result stays over and the report shows it — truncating the task
 * spec would be the worse failure.
 */
export function fitSections(sections: SectionInput[], totalTokens: number): FitSectionsResult {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    throw new StarlingError('INVALID_ARGUMENT', 'totalTokens must be a positive number', {
      details: { totalTokens },
    });
  }

  const capped = capEntries(sections);
  const current = () => assemble(capped, ({ cut }) => cut.text);
  let total = estimateTokens(current());
  if (total <= totalTokens) return { text: current(), report: reportFor(capped) };

  const order = capped
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !isProtected(entry.section))
    .sort((a, b) => a.entry.section.priority - b.entry.section.priority || a.index - b.index);

  for (const { entry, index } of order) {
    while (total > totalTokens) {
      const tokens = estimateTokens(entry.cut.text);
      if (tokens === 0) break;
      const targetTokens = Math.max(0, tokens - (total - totalTokens));
      // Re-cut from the original text, never from a text that already carries a marker.
      const cut = cutToTokens(sections[index]?.text ?? entry.section.text, targetTokens);
      const trimmedTokens = estimateTokens(cut.text);
      if (trimmedTokens >= tokens) break;
      entry.cut = cut;
      total = estimateTokens(current());
    }
    if (total <= totalTokens) break;
  }

  return {
    text: current(),
    report: reportFor(capped),
  };
}

/**
 * What the builders call: per-section ceilings always, plus the overall budget when one was asked
 * for. Keeping this decision in one place means worker/fixer/resolver behave the same way.
 */
export function applySectionBudgets(sections: SectionInput[], totalTokens?: number): FitSectionsResult {
  return totalTokens === undefined ? capSections(sections) : fitSections(sections, totalTokens);
}
