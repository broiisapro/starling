import type { AuditVerdict, Run, TaskRun } from '@starling/core/browser';
import type { SkyState } from '../../data/reducer';
import { activeRunOf } from '../../data/selectors';
import { formatTokens, formatUsd } from '../../lib/format';

/**
 * The leaderboard's whole derivation: `SkyState` in, ranked boards out. Pure and DOM-free, so the
 * fixture truths are asserted without a browser (see `derive.test.ts`).
 *
 * Everything is scoped to the **active run**. `state.events` is capped at 5,000 and may be missing
 * history, so the `Run`/`TaskRun` snapshots are the primary source; events are only consulted where
 * the snapshot cannot know the answer (migration arrivals for tasks the run does not list).
 */

/** Top five per board: a dock card is read sideways, not scrolled. */
export const BOARD_SIZE = 5;

export type BoardId = 'fastest' | 'hungriest' | 'cleanest' | 'stubborn' | 'perch' | 'thriftiest';

/** `unit` is presentation metadata: the shell's tooltip and the playground legend use it. */
export type BoardUnit = 'seconds' | 'tokens' | 'fixes' | 'tasks' | 'usd';

export interface BoardEntry {
  /** Task key, or node id for a perch board. Stable across renders and used for FLIP identity. */
  key: string;
  label: string;
  /** Machine-readable number the rank is computed from. */
  value: number;
  /** Human string shown in the card, e.g. "33.4s", "29.4k", "MacBook Pro". */
  display: string;
  /** Set for entries that describe a roost rather than a task. */
  nodeId?: string;
}

export interface Board {
  id: string;
  title: string;
  blurb: string;
  unit: string;
  entries: BoardEntry[];
}

/** A row that carries a hidden secondary sort key (never rendered). */
interface Ranked extends BoardEntry {
  /** Never meaningful alone: only breaks a tie in `value`. */
  weight?: number;
}

type Direction = 'asc' | 'desc';

/** Locale-independent so ranks are identical on every machine and in every test. */
function byKey(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function toEntry(entry: Ranked): BoardEntry {
  return entry.nodeId === undefined
    ? { key: entry.key, label: entry.label, value: entry.value, display: entry.display }
    : {
        key: entry.key,
        label: entry.label,
        value: entry.value,
        display: entry.display,
        nodeId: entry.nodeId,
      };
}

/**
 * Sort, cut to five and drop the hidden weight. Ties fall back to `weight` (descending) and then to
 * the key, so the same state always yields the same order — the FLIP animation depends on that.
 */
function rank(entries: Ranked[], direction: Direction): BoardEntry[] {
  const sorted = [...entries].sort((a, b) => {
    const primary = direction === 'asc' ? a.value - b.value : b.value - a.value;
    if (primary !== 0) return primary;
    const secondary = (b.weight ?? 0) - (a.weight ?? 0);
    if (secondary !== 0) return secondary;
    return byKey(a.key, b.key);
  });
  return sorted.slice(0, BOARD_SIZE).map(toEntry);
}

/** One decimal under a minute ("33.4s"), then "2m 04s". Used by the timing boards. */
export function formatBoardSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 60_000) {
    const tenths = Math.round(ms / 100) / 10;
    return `${Number.isInteger(tenths) ? tenths.toFixed(0) : tenths.toFixed(1)}s`;
  }
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

function fixLabel(count: number): string {
  return count === 1 ? '1 fix' : `${count} fixes`;
}

function taskLabel(run: Run, key: string): string {
  return run.plan?.tasks.find((task) => task.key === key)?.title ?? key;
}

/**
 * Epic 40 adds `nodeName` to `TaskRun`. Read it structurally so this file compiles before and after
 * that lands, and fall back to the registry (`state.nodes`) then the raw id.
 */
type TaskRunWithNodeName = TaskRun & { nodeName?: string };

function nodeLabel(state: SkyState, nodeId: string, task?: TaskRun): string {
  const fromTask = (task as TaskRunWithNodeName | undefined)?.nodeName;
  return fromTask ?? state.nodes[nodeId]?.name ?? nodeId;
}

function isMerged(task: TaskRun): boolean {
  return task.status === 'merged';
}

/** Merged tasks whose timings are both present and sane. Missing timings are skipped, not zeroed. */
function landedWithTiming(tasks: TaskRun[]): TaskRun[] {
  return tasks.filter(
    (task) =>
      isMerged(task) &&
      task.startedAt !== undefined &&
      task.finishedAt !== undefined &&
      task.finishedAt >= task.startedAt,
  );
}

function durationMs(task: TaskRun): number | undefined {
  if (task.startedAt === undefined || task.finishedAt === undefined) return undefined;
  return task.finishedAt - task.startedAt;
}

function firstPassVerdict(verdicts: AuditVerdict[]): AuditVerdict | undefined {
  return verdicts.find(
    (verdict) =>
      verdict.attempt === 1 &&
      verdict.pass &&
      verdict.checks.length > 0 &&
      verdict.checks.every((check) => check.ok),
  );
}

/**
 * "Σ checks[].durationMs when present, else verdict ts − task start". The sum is only trusted when
 * *every* check reported a duration: a partial sum would flatter the bird that reported least.
 */
export function auditDurationMs(verdict: AuditVerdict, task: TaskRun): number | undefined {
  const checks = verdict.checks;
  if (checks.length > 0 && checks.every((check) => typeof check.durationMs === 'number')) {
    return checks.reduce((sum, check) => sum + (check.durationMs ?? 0), 0);
  }
  if (task.startedAt !== undefined && verdict.ts >= task.startedAt) return verdict.ts - task.startedAt;
  return undefined;
}

function failedVerdicts(verdicts: AuditVerdict[]): number {
  return verdicts.filter((verdict) => !verdict.pass).length;
}

function boardWith(
  id: BoardId,
  title: string,
  unit: BoardUnit,
  entries: Ranked[],
  direction: Direction,
  blurb: (leader: BoardEntry) => string,
): Board | undefined {
  const ranked = rank(entries, direction);
  const leader = ranked[0];
  if (leader === undefined) return undefined;
  return { id, title, unit, blurb: blurb(leader), entries: ranked };
}

function fastestBoard(tasks: TaskRun[], run: Run): Board | undefined {
  const entries: Ranked[] = landedWithTiming(tasks).map((task) => ({
    key: task.taskKey,
    label: taskLabel(run, task.taskKey),
    value: durationMs(task) ?? 0,
    display: formatBoardSeconds(durationMs(task) ?? 0),
  }));
  return boardWith('fastest', 'Fastest bird', 'seconds', entries, 'asc', (leader) => {
    return `${leader.label} landed in ${leader.display} — a personal best for the flock.`;
  });
}

function hungriestBoard(tasks: TaskRun[], run: Run): Board | undefined {
  const entries: Ranked[] = tasks
    .map((task) => {
      // `cached` is a subset of `input`, so it must not be added again.
      const tokens = task.usage.input + task.usage.output;
      return { task, tokens };
    })
    .filter((candidate) => candidate.tokens > 0)
    .map(({ task, tokens }) => ({
      key: task.taskKey,
      label: taskLabel(run, task.taskKey),
      value: tokens,
      display: formatTokens(tokens),
    }));
  return boardWith('hungriest', 'Hungriest bird', 'tokens', entries, 'desc', (leader) => {
    return `${leader.label} pecked through ${leader.display} tokens — the biggest appetite in the sky.`;
  });
}

function cleanestBoard(tasks: TaskRun[], run: Run, verdicts: SkyState['verdicts']): Board | undefined {
  const entries: Ranked[] = [];
  for (const task of tasks) {
    const verdict = firstPassVerdict(verdicts[task.taskKey] ?? []);
    if (verdict === undefined) continue;
    const duration = auditDurationMs(verdict, task);
    if (duration === undefined) continue;
    entries.push({
      key: task.taskKey,
      label: taskLabel(run, task.taskKey),
      value: duration,
      display: formatBoardSeconds(duration),
    });
  }
  return boardWith('cleanest', 'Cleanest audit', 'seconds', entries, 'asc', (leader) => {
    return `${leader.label} passed every check first time in ${leader.display} — no fix loop, no fuss.`;
  });
}

function stubbornBoard(tasks: TaskRun[], run: Run, verdicts: SkyState['verdicts']): Board | undefined {
  const entries: Ranked[] = [];
  for (const task of tasks) {
    const history = verdicts[task.taskKey] ?? [];
    const failed = failedVerdicts(history);
    if (task.attempts === 0 && failed === 0) continue;
    entries.push({
      key: task.taskKey,
      label: taskLabel(run, task.taskKey),
      value: task.attempts,
      display: fixLabel(task.attempts),
      weight: failed,
    });
  }
  return boardWith('stubborn', 'Most stubborn', 'fixes', entries, 'desc', (leader) => {
    return `${leader.label} needed ${leader.display} to get through the audit — relentless.`;
  });
}

/** Node id → task count + a label seen on one of its tasks (for `nodeName` when core adds it). */
function perchCounts(state: SkyState, run: Run): Map<string, { count: number; task?: TaskRun }> {
  const counts = new Map<string, { count: number; task?: TaskRun }>();
  const bump = (nodeId: string, task?: TaskRun): void => {
    const current = counts.get(nodeId);
    counts.set(nodeId, { count: (current?.count ?? 0) + 1, task: current?.task ?? task });
  };

  for (const task of Object.values(run.tasks)) {
    if (task.nodeId === undefined) continue;
    bump(task.nodeId, task);
  }

  // A migration's arrival is already reflected in `TaskRun.nodeId`, so counting it again would
  // double-book the task. Events are only a fallback for a task the run snapshot does not list
  // (hydration lag, or a capped event window).
  for (const event of state.events) {
    if (event.type !== 'task.migrated' || event.runId !== run.id) continue;
    if (run.tasks[event.payload.taskKey] !== undefined) continue;
    bump(event.payload.toNode);
  }

  return counts;
}

function perchBoard(state: SkyState, run: Run): Board | undefined {
  const entries: Ranked[] = [...perchCounts(state, run)].map(([nodeId, { count, task }]) => ({
    key: nodeId,
    label: nodeLabel(state, nodeId, task),
    value: count,
    display: count === 1 ? '1 task' : `${count} tasks`,
    nodeId,
  }));
  return boardWith('perch', 'Busiest perch', 'tasks', entries, 'desc', (leader) => {
    return `${leader.label} flew ${leader.display} — the hardest-working laptop in the flock.`;
  });
}

/**
 * Cheapest roost per landing: total `costUsd` of a node's merged tasks divided by how many merged.
 * Read as "cost per merged task" (the average), not as a single cheapest task.
 */
function thriftiestBoard(state: SkyState, run: Run): Board | undefined {
  const totals = new Map<string, { cost: number; merged: number; task?: TaskRun }>();
  for (const task of Object.values(run.tasks)) {
    if (!isMerged(task) || task.nodeId === undefined || !Number.isFinite(task.costUsd)) continue;
    const current = totals.get(task.nodeId);
    totals.set(task.nodeId, {
      cost: (current?.cost ?? 0) + task.costUsd,
      merged: (current?.merged ?? 0) + 1,
      task: current?.task ?? task,
    });
  }
  const entries: Ranked[] = [...totals]
    .filter(([, total]) => total.merged > 0)
    .map(([nodeId, total]) => {
      const perTask = total.cost / total.merged;
      return {
        key: nodeId,
        label: nodeLabel(state, nodeId, total.task),
        value: perTask,
        display: formatUsd(perTask),
        nodeId,
      };
    });
  return boardWith('thriftiest', 'Thriftiest perch', 'usd', entries, 'asc', (leader) => {
    return `${leader.label} landed work for ${leader.display} a task — light on the wallet, heavy on the wings.`;
  });
}

/** Every board that has data, in reading order. A board with no qualifying task is hidden rather
 * than shown empty: a leaderboard with a placeholder row reads as broken on a projector.
 */
export function buildBoards(state: SkyState): Board[] {
  const run = activeRunOf(state);
  if (run === undefined) return [];
  const tasks = Object.values(run.tasks);
  const boards = [
    fastestBoard(tasks, run),
    hungriestBoard(tasks, run),
    cleanestBoard(tasks, run, state.verdicts),
    stubbornBoard(tasks, run, state.verdicts),
    perchBoard(state, run),
    thriftiestBoard(state, run),
  ];
  return boards.filter((board): board is Board => board !== undefined);
}
