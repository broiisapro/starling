import type { TaskSpec } from '@starling/core/browser';

/**
 * Tile colours: a deterministic walk over the starling-iridescent tokens, in plan order.
 *
 * Colours come from CSS custom properties rather than hex so they work in both themes and stay in
 * the one design system (`src/lib/tokens.pcss`). The order is fixed: the same plan always paints the
 * same task the same colour, which matters when two screenshots are compared on stage.
 */
const LANE_COLOURS = [
  'var(--color-irid-teal)',
  'var(--color-irid-purple)',
  'var(--color-irid-blue)',
  'var(--color-irid-green)',
  'var(--color-irid-rose)',
  'var(--color-amber-horizon)',
  'var(--color-amber-soft)',
  'var(--color-violet-500)',
] as const;

export const LANE_PALETTE = LANE_COLOURS;
export const UNOWNED_COLOUR = 'var(--color-ink-4)';
export const CONFLICT_COLOUR = '#fb7185';
export const VIOLATION_COLOUR = '#f87171';
export const SELECTED_STROKE = 'var(--color-focus)';

export type LaneColours = ReadonlyMap<string, string>;

/** taskKey → colour, deterministic over the plan's task order. */
export function laneColours(tasks: readonly TaskSpec[]): LaneColours {
  const colours = new Map<string, string>();
  tasks.forEach((task, index) => {
    colours.set(task.key, LANE_COLOURS[index % LANE_COLOURS.length] ?? UNOWNED_COLOUR);
  });
  return colours;
}

export function colourFor(colours: LaneColours, taskKey: string | undefined): string {
  if (taskKey === undefined) return UNOWNED_COLOUR;
  return colours.get(taskKey) ?? UNOWNED_COLOUR;
}

/** Task key → title, for legends, aria labels and the table. */
export function laneTitles(tasks: readonly TaskSpec[]): ReadonlyMap<string, string> {
  return new Map(tasks.map((task) => [task.key, task.title] as const));
}
