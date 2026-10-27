/**
 * The pure part of the Starling shell prompt: choose a run, count its tasks, render one short line.
 *
 * Nothing here touches the filesystem, the network or the clock. `refresh.ts` owns the side effects;
 * this file is what the tests pin down, so the format can never drift from the README.
 *
 * Type-only imports keep this module loadable from anywhere (and cheap for a spawned prompt helper).
 */
import type { Run, RunStatus } from '../../packages/core/src/index.ts';

/** Run states that mean "the flock is flying right now" (ARCHITECTURE §6 `Run.status`). */
export const ACTIVE_RUN_STATUSES = ['mapping', 'planning', 'planned', 'running'] as const;

/** Run states that mean "it has landed" — shown for a short while, then the segment disappears. */
export const TERMINAL_RUN_STATUSES = ['finished', 'failed', 'cancelled'] as const;

/** Task states that count as work in flight. */
export const IN_FLIGHT_TASK_STATUSES = ['running', 'auditing', 'fixing', 'merging'] as const;

/** A landed run keeps the prompt occupied for this long, then the segment goes quiet. */
export const FINISHED_WINDOW_MS = 10 * 60_000;

export interface TaskCounts {
  /** `running | auditing | fixing | merging`. */
  inFlight: number;
  /** `merged`. */
  done: number;
  /** `failed | conflict`. */
  failed: number;
  /** Every task in the run, whatever its state. */
  total: number;
}

export type SegmentStyle = 'plain' | 'zsh' | 'bash';

export interface SegmentOptions {
  /** ASCII-only output (`st 12/30`) for terminals, fonts or `$LANG`s without the bird. */
  ascii?: boolean;
  /** Render the landed form (`🐦 ✓30`) instead of the flying form (`🐦 12/30`). */
  finished?: boolean;
  /** `zsh`/`bash` wrap ANSI escapes in `%{…%}`/`\[…\]` so the prompt's width math stays right. */
  style?: SegmentStyle;
}

const BIRD = '\u{1F426}';
const CHECK = '\u2713';
const CROSS = '\u2717';

const RESET = '\u001b[0m';
const CYAN = '\u001b[36m';
const GREEN = '\u001b[32m';

/** True for `mapping | planning | planned | running`. */
export function isActiveRunStatus(status: RunStatus): boolean {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

/** True for `finished | failed | cancelled` — the run has landed, one way or another. */
export function isLandedRunStatus(status: RunStatus): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

/**
 * Which run the prompt should talk about.
 *
 * 1. The newest run that is still mapping/planning/planned/running (highest `startedAt`).
 * 2. Otherwise the newest run that landed within the last {@link FINISHED_WINDOW_MS}.
 *
 * Ties go to the earlier entry in the array, because the server returns runs most-recent-first and a
 * tie means the store has no better ordering to offer. Future `startedAt` values (clock skew) are
 * treated as "now" rather than rejected: the prompt is a glance, not an audit.
 */
export function pickRun(runs: readonly Run[], now: number): Run | undefined {
  let active: Run | undefined;
  let landed: Run | undefined;

  for (const run of runs) {
    if (isActiveRunStatus(run.status)) {
      if (!active || run.startedAt > active.startedAt) active = run;
      continue;
    }
    if (!isLandedRunStatus(run.status)) continue;
    const endedAt = run.finishedAt ?? run.startedAt;
    if (endedAt < now - FINISHED_WINDOW_MS) continue;
    if (!landed || endedAt > (landed.finishedAt ?? landed.startedAt)) landed = run;
  }

  return active ?? landed;
}

/** Count a run's tasks by bucket. Missing/empty `tasks` counts as zero (hand-written fixtures, old runs). */
export function countTasks(run: Pick<Run, 'tasks'>): TaskCounts {
  const counts: TaskCounts = { inFlight: 0, done: 0, failed: 0, total: 0 };
  const tasks = run.tasks ?? {};
  for (const task of Object.values(tasks)) {
    counts.total += 1;
    const status = task.status;
    if ((IN_FLIGHT_TASK_STATUSES as readonly string[]).includes(status)) counts.inFlight += 1;
    else if (status === 'merged') counts.done += 1;
    else if (status === 'failed' || status === 'conflict') counts.failed += 1;
  }
  return counts;
}

function wrapForStyle(text: string, style: SegmentStyle, colour: string): string {
  const on = style === 'zsh' ? `%{${colour}%}` : style === 'bash' ? `\\[${colour}\\]` : colour;
  const off = style === 'zsh' ? `%{${RESET}%}` : style === 'bash' ? `\\[${RESET}\\]` : RESET;
  return `${on}${text}${off}`;
}

/**
 * Render the segment.
 *
 * | state    | unicode    | ascii       |
 * | -------- | ---------- | ----------- |
 * | flying   | `🐦 12/30` | `st 12/30`  |
 * | failures | `🐦 12/30 ✗2` | `st 12/30 x2` |
 * | landed   | `🐦 ✓30`   | `st ok 30`  |
 * | nothing  | `''`       | `''`        |
 *
 * `planned`/`pending`/`ready` tasks are neither in flight nor done, so the two numbers can legitimately
 * not add up: the denominator is the plan, the numerator is what is moving.
 *
 * Colour is on for the two prompt styles and off for `plain` — `plain` is for `$()` captures, pipes and
 * snapshots, where a stray escape sequence is worse than a dull prompt.
 */
export function formatSegment(counts: TaskCounts, opts: SegmentOptions = {}): string {
  if (counts.total <= 0) return '';
  const ascii = opts.ascii === true;
  const style = opts.style ?? 'plain';

  const head = opts.finished
    ? `${ascii ? 'st ok' : `${BIRD} ${CHECK}`}${ascii ? ' ' : ''}${counts.done}`
    : `${ascii ? 'st' : BIRD} ${counts.inFlight}/${counts.total}`;
  const tail = counts.failed > 0 ? ` ${ascii ? 'x' : CROSS}${counts.failed}` : '';
  const text = `${head}${tail}`;

  if (style === 'plain') return text;
  return wrapForStyle(text, style, opts.finished ? GREEN : CYAN);
}
