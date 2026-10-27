/**
 * The palette's item model and its builders.
 *
 * Everything the palette can jump to is a `PaletteItem`: a group, a visible label, an optional hint,
 * optional search keywords, an optional hotkey hint and a zero-argument action. Builders are pure
 * functions over the read-only store snapshot, so they are tested without a DOM and the component
 * stays a thin keyboard shell.
 */
import type { Run, TaskRun } from '@starling/core/browser';
import type { SkyState } from '../../data/reducer';
import { activeRunOf, sortedRuns } from '../../data/selectors';
import { statusLabel } from '../../lib/status';
import { RECENT_LIMIT } from './recent';

export type PaletteGroup = 'recent' | 'commands' | 'features' | 'tasks' | 'runs';

export const PALETTE_GROUPS: readonly PaletteGroup[] = ['recent', 'commands', 'features', 'tasks', 'runs'];

export interface PaletteItem {
  /** Stable across renders and runs: `task:csv-export`, `run:<ulid>`, `feature:dag`, … */
  id: string;
  group: PaletteGroup;
  label: string;
  hint?: string;
  keywords?: string[];
  /** Display form, e.g. `mod+k` or `L`. The item does not bind it; the shell registry does. */
  hotkey?: string;
  run(): void;
}

/** Structural subset of the L39 feature manifest, so a manifest can be passed straight through. */
export type PaletteFeatureKind = 'view' | 'panel' | 'overlay' | 'page';

export interface PaletteFeature {
  id: string;
  title: string;
  description: string;
  kind: PaletteFeatureKind;
  /** A lucide-react icon name, e.g. `Command`. Unknown names fall back to `Command`. */
  icon: string;
  hotkey?: string;
}

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  hotkey?: string;
  run(): void;
}

const noop = (): void => {};

function taskItem(taskKey: string, title: string, taskRun: TaskRun | undefined): PaletteItem {
  const status = taskRun?.status ?? 'pending';
  return {
    id: `task:${taskKey}`,
    group: 'tasks',
    label: title,
    hint: `${taskKey} · ${statusLabel(status)}`,
    keywords: [taskKey, status],
    run: noop,
  };
}

/**
 * Tasks come from the plan (not from `run.tasks`), so a task that has not started yet still shows up
 * — a command palette that hides half the plan until dispatch is not a palette.
 */
export function taskItems(state: SkyState, onSelectTask: (key: string) => void = noop): PaletteItem[] {
  const run = activeRunOf(state);
  const specs = run?.plan?.tasks ?? [];
  return specs.map((spec) => {
    const item = taskItem(spec.key, spec.title, run?.tasks[spec.key]);
    item.keywords = [spec.key, ...spec.lane.owns, spec.goal];
    item.run = () => onSelectTask(spec.key);
    return item;
  });
}

function runItem(run: Run): PaletteItem {
  const item: PaletteItem = {
    id: `run:${run.id}`,
    group: 'runs',
    label: run.goal.text,
    hint: run.status,
    keywords: [run.id, run.goal.repoPath],
    run: noop,
  };
  if (run.integrationBranch !== undefined) item.keywords?.push(run.integrationBranch);
  return item;
}

/** Runs, newest first (the run picker's order). The label is the goal; the hint is the run status. */
export function runItems(state: SkyState, onSelectRun: (runId: string) => void = noop): PaletteItem[] {
  return sortedRuns(state).map((run) => {
    const item = runItem(run);
    item.run = () => onSelectRun(run.id);
    return item;
  });
}

export function featureItems(
  features: readonly PaletteFeature[],
  onOpenFeature: (id: string) => void = noop,
): PaletteItem[] {
  return features.map((feature) => {
    const item: PaletteItem = {
      id: `feature:${feature.id}`,
      group: 'features',
      label: feature.title,
      hint: feature.description,
      keywords: [feature.id, feature.kind],
      run: () => onOpenFeature(feature.id),
    };
    if (feature.hotkey !== undefined) item.hotkey = feature.hotkey;
    return item;
  });
}

export function commandItems(commands: readonly PaletteCommand[]): PaletteItem[] {
  return commands.map((command) => {
    const item: PaletteItem = {
      id: `command:${command.id}`,
      group: 'commands',
      label: command.label,
      run: command.run,
    };
    if (command.hint !== undefined) item.hint = command.hint;
    if (command.hotkey !== undefined) item.hotkey = command.hotkey;
    return item;
  });
}

/**
 * Resolve stored recent ids against the items that exist right now, in recency order.
 *
 * Unknown ids (a task from yesterday's run, a feature that was removed) are skipped silently: the
 * history is a shortcut, not a contract.
 */
export function recentItems(
  items: readonly PaletteItem[],
  recents: readonly string[],
  limit = RECENT_LIMIT,
): PaletteItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const result: PaletteItem[] = [];
  for (const id of recents) {
    if (result.length >= limit) break;
    if (seen.has(id)) continue;
    const item = byId.get(id);
    if (item === undefined) continue;
    seen.add(id);
    result.push({ ...item, group: 'recent' });
  }
  return result;
}
