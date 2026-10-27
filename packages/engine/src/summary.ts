/** Deterministic human-readable run summaries. The writer model, when configured, may replace one. */

import type { Run } from '@starling/core';
import { shortId } from '@starling/core';
import { countStatus } from './state';

/** `0s`, `9s`, `2m 03s`, `1h 04m`. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Prefer the run's own stamps; `metrics.elapsedMs` can lag behind the final snapshot. */
function elapsedOf(run: Run): number {
  if (run.finishedAt !== undefined) return Math.max(0, run.finishedAt - run.startedAt);
  return run.metrics.elapsedMs;
}

/** The template used without a `writer` model, and as the fallback when the writer fails. */
export interface SummaryOptions {
  /** Why the run ended early (a mapping/planning failure). */
  reason?: string;
  /** Set when the hard budget cap ended dispatch; `skipped` never got a session. */
  budget?: { maxUsd: number; skipped: number };
}

function budgetNote(options: SummaryOptions): string {
  if (options.budget === undefined || options.budget.skipped <= 0) return '';
  const cap = `$${options.budget.maxUsd.toFixed(2)}`;
  return ` Budget cap ${cap} reached: ${plural(options.budget.skipped, 'task')} skipped.`;
}

export function renderRunSummary(run: Run, options: SummaryOptions = {}): string {
  if (options.reason !== undefined) {
    return `Starling run ${shortId(run.id)} ended: ${options.reason}.${budgetNote(options)}`;
  }
  if (run.status === 'planned') {
    const total = run.plan?.tasks.length ?? 0;
    return `Dry run for ${shortId(run.id)}: planned ${plural(total, 'task')}; nothing was dispatched. 🐦`;
  }
  if (run.status === 'cancelled') {
    return `Starling run ${shortId(run.id)} was cancelled after ${formatDuration(elapsedOf(run))}.${budgetNote(options)}`;
  }
  const merged = countStatus(run, 'merged');
  const failed = countStatus(run, 'failed');
  const conflicts = countStatus(run, 'conflict');
  const cancelled = countStatus(run, 'cancelled');
  const total = Object.keys(run.tasks).length;
  const suffix: string[] = [];
  if (failed > 0) suffix.push(plural(failed, 'failure'));
  if (conflicts > 0) suffix.push(plural(conflicts, 'conflict'));
  if (cancelled > 0) suffix.push(`${cancelled} cancelled`);
  const detail = suffix.length === 0 ? 'no failures' : suffix.join(', ');
  const branch =
    run.integrationBranch === undefined
      ? 'no integration branch'
      : `Integration branch ${run.integrationBranch}`;
  return (
    `The murmuration landed ${merged}/${total} tasks in ${formatDuration(elapsedOf(run))} ` +
    `(${detail}). ${branch} is ready.${budgetNote(options)}`
  );
}

/** Instruction for the optional `writer` model. Kept short so a local model answers quickly. */
export function writerPrompt(run: Run, options: SummaryOptions = {}): string {
  const merged = countStatus(run, 'merged');
  const failed = countStatus(run, 'failed');
  const conflicts = countStatus(run, 'conflict');
  const cancelled = countStatus(run, 'cancelled');
  const lines = [
    `Write one plain-text paragraph (max 60 words) summarising a Starling coding run.`,
    `Goal: ${run.goal.text}`,
    `Tasks: ${Object.keys(run.tasks).length} total, ${merged} merged, ${failed} failed, ${conflicts} conflicted, ${cancelled} cancelled.`,
    `Integration branch: ${run.integrationBranch ?? 'none'}.`,
    `Elapsed: ${formatDuration(elapsedOf(run))}.`,
  ];
  if (options.budget !== undefined && options.budget.skipped > 0) {
    lines.push(
      `Budget: the $${options.budget.maxUsd.toFixed(2)} cap was reached; ${options.budget.skipped} task(s) were skipped.`,
    );
  }
  lines.push('Plain text only, no markdown, no greeting.');
  return lines.join('\n');
}
