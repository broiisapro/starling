/**
 * Pure derivations for the palette: turn the store snapshot + optional manifests into the grouped,
 * ranked rows the component renders.
 *
 * Kept separate from `CommandPalette.tsx` so the ranking/grouping rules are tested without a DOM and
 * the component only owns focus, selection and keyboard state.
 */
import type { SkyState } from '../../data/reducer';
import { type Ranked, rankItems } from './fuzzy';
import {
  commandItems,
  featureItems,
  type PaletteCommand,
  type PaletteFeature,
  type PaletteGroup,
  type PaletteItem,
  recentItems,
  runItems,
  taskItems,
} from './items';

export const GROUP_LABELS: Record<PaletteGroup, string> = {
  recent: 'Recent',
  commands: 'Commands',
  features: 'Views',
  tasks: 'Tasks',
  runs: 'Runs',
};

/** The non-recent group order. Recent rows are prepended by `recentItems` when the query is empty. */
export const RESULT_GROUPS: readonly Exclude<PaletteGroup, 'recent'>[] = [
  'commands',
  'features',
  'tasks',
  'runs',
];

export interface PaletteSource {
  state: SkyState;
  features?: readonly PaletteFeature[];
  commands?: readonly PaletteCommand[];
  onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void;
  onOpenFeature?(id: string): void;
}

/**
 * Every jumpable item, in a stable order: commands, views, tasks, runs.
 *
 * Handlers are optional — without them the palette still lists tasks and runs (selecting one just
 * closes the dialog). That is what makes the component usable in a bare playground and keeps the
 * shell from having to pass no-ops.
 */
export function collectItems(source: PaletteSource): PaletteItem[] {
  const commands = commandItems(source.commands ?? []);
  const features = featureItems(source.features ?? [], source.onOpenFeature);
  const tasks = taskItems(source.state, source.onSelectTask);
  const runs = runItems(source.state, source.onSelectRun);
  return [...commands, ...features, ...tasks, ...runs];
}

export interface PaletteGroupResult {
  id: PaletteGroup;
  label: string;
  items: Ranked<PaletteItem>[];
}

function asRanked(item: PaletteItem): Ranked<PaletteItem> {
  return { item, score: 0, ranges: [] };
}

/**
 * Group rows for a query.
 *
 * - Empty query: recent picks first (max `RECENT_LIMIT`), then each group in `RESULT_GROUPS` order,
 *   capped at `limit` rows in total.
 * - Non-empty query: rank *all* items, cap at `limit`, then bucket by group so the headings stay in
 *   the same order however the scores fall. A group with no match is omitted, never rendered empty.
 */
export function groupResults(
  items: readonly PaletteItem[],
  query: string,
  recents: readonly string[] = [],
  limit = 50,
): PaletteGroupResult[] {
  if (limit <= 0) return [];
  const needle = query.trim();

  if (needle === '') {
    const groups: PaletteGroupResult[] = [];
    let remaining = limit;

    const recent = recentItems(items, recents);
    if (recent.length > 0 && remaining > 0) {
      const shown = recent.slice(0, remaining);
      groups.push({ id: 'recent', label: GROUP_LABELS.recent, items: shown.map(asRanked) });
      remaining -= shown.length;
    }

    for (const id of RESULT_GROUPS) {
      if (remaining <= 0) break;
      const bucket = items.filter((item) => item.group === id);
      if (bucket.length === 0) continue;
      const shown = bucket.slice(0, remaining);
      groups.push({ id, label: GROUP_LABELS[id], items: shown.map(asRanked) });
      remaining -= shown.length;
    }
    return groups;
  }

  const ranked = rankItems(needle, items, limit);
  const buckets = new Map<PaletteGroup, Ranked<PaletteItem>[]>();
  for (const entry of ranked) {
    const bucket = buckets.get(entry.item.group);
    if (bucket === undefined) buckets.set(entry.item.group, [entry]);
    else bucket.push(entry);
  }

  const groups: PaletteGroupResult[] = [];
  for (const id of RESULT_GROUPS) {
    const bucket = buckets.get(id);
    if (bucket === undefined || bucket.length === 0) continue;
    groups.push({ id, label: GROUP_LABELS[id], items: bucket });
  }
  return groups;
}

/** Flatten to the keyboard's selection order (group order, then row order). */
export function flattenGroups(groups: readonly PaletteGroupResult[]): PaletteItem[] {
  return groups.flatMap((group) => group.items.map((entry) => entry.item));
}

/** Ranges for a rendered row, looked up by item id. Used by the component without a second ranking. */
export function rangesFor(groups: readonly PaletteGroupResult[], id: string): [number, number][] {
  for (const group of groups) {
    for (const entry of group.items) {
      if (entry.item.id === id) return entry.ranges;
    }
  }
  return [];
}
