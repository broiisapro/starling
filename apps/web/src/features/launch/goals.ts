import type { LaunchGoal } from './types';

/**
 * The sky-todo demo goals, verbatim from `examples/sky-todo/demo-goals/*.md`.
 *
 * They are constants rather than a fetch so the chips keep working in demo mode and offline (the
 * dashboard's documented fallback). The shell may pass its own `goals` prop; this array is what the
 * Playground uses and what the FIX REQUEST asks Epic 41 to adopt.
 *
 * The texts are duplicated on purpose: a browser bundle must not read the repo at runtime.
 */
export const DEMO_GOALS: readonly LaunchGoal[] = [
  {
    name: 'quick-wins',
    text: "Show the open-task count in the browser tab title, show today's date in the header, and add a footer note with how many distinct tags are in use.",
    hint: '3 tiny, disjoint tasks · the smoke test · ~2 min',
  },
  {
    name: 'launch-day',
    text: 'Add dark mode with a toggle, live search filtering, CSV export, keyboard shortcuts (n = new, / = search, ? = help), due-date badges, and fix the overdue-calculation and date-sorting bugs in src/lib/dates.ts.',
    hint: '7 tasks for the stage · the demo everyone knows',
  },
  {
    name: 'launch-day-xl',
    text: 'Add dark mode with a toggle, live search filtering, CSV export, keyboard shortcuts (n = new, / = search, ? = help), due-date badges, undo/redo, a stats footer, tags with filter chips, and fix the overdue-calculation and date-sorting bugs in src/lib/dates.ts.',
    hint: '12 tasks · shows the flock at capacity',
  },
  {
    name: 'conflict-bait',
    text: 'Add a "Sort by due date" toggle and a "Delete all" button to the footer in src/ui/render.ts.',
    hint: 'Two tasks on one file · deliberately collides',
  },
] as const;

/** The default repo the demo uses; a shell with a recent-repos list will override it. */
export const DEMO_REPO_PATH = 'examples/sky-todo';

/** Label for the chip row. */
export const GOAL_CHIPS_LABEL = 'Demo goals';
