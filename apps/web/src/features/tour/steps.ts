import type { Run, TaskStatus } from '@starling/core/browser';
import type { SkyState } from '../../data/reducer';
import { activeRunOf } from '../../data/selectors';
import type { TourStep } from './types';

/**
 * Statuses that mean "there is something to look at on the right-hand side". The drawer shows a
 * running agent best, then one being audited or fixed; a landed task has a transcript but no motion.
 */
const DRAWER_STATUSES: readonly TaskStatus[] = ['running', 'auditing', 'fixing'];

/**
 * The seven-page tour, in the order a judge should meet the dashboard: the whole flock, the two
 * centre views, the roosts, one agent's transcript, the landing strip, the meter, and the menu that
 * hides everything else.
 *
 * Anchors are **existing** shell hooks only. `[data-shell="views-menu"]` is Epic 112's control and is
 * deliberately the one optional anchor: if it has not merged (or the menu moved), step 7 falls back
 * to a centred card rather than pointing at nothing.
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'sky',
    title: 'This is the murmuration',
    body: 'Every bird is an agent session in its own git worktree. Teal means flying, amber means being audited, green means landed. None of it is scripted: the flock is doing the work on this laptop, live.',
    anchor: '[data-region="sky"]',
    placement: 'center',
  },
  {
    id: 'views',
    title: 'Two ways to watch the same run',
    body: 'The sky shows the motion; the flight plan shows the task graph. Lanes are disjoint, so two agents can edit in parallel without ever touching the same file. Press 1 and 2 to flip between them.',
    anchor: '[role="tablist"][aria-label="Centre view"]',
    placement: 'bottom',
  },
  {
    id: 'flock',
    title: 'Meet the flock',
    body: 'Each roost is a machine: the hub, plus any perches on the LAN. The pips are session slots. If a perch goes quiet mid-task, the task is rescheduled on another roost instead of being lost.',
    anchor: '[data-region="flock"]',
    placement: 'right',
  },
  {
    id: 'drawer',
    title: 'Read over an agent’s shoulder',
    body: 'Select any card to see its transcript: tool calls, file edits, the auditor’s verdict and the diff. The audit runs the tests, checks the lane and asks a local model whether the work actually matches the definition of done.',
    anchor: '[data-region="drawer"]',
    placement: 'left',
    action: 'select-first-running-task',
  },
  {
    id: 'queue',
    title: 'The landing strip',
    body: 'Finished branches queue here. The merger lands them onto the integration branch one at a time, so a conflict is a single task to resolve — not a whole-run failure.',
    anchor: '[data-region="queue"]',
    placement: 'top',
  },
  {
    id: 'metrics',
    title: 'What the run cost',
    body: 'API spend for the planner and workers, next to the calls that ran free on this laptop. The auditor, summariser and writer are local, which is why a whole feature run costs cents rather than dollars.',
    anchor: '[data-region="metrics"]',
    placement: 'top',
  },
  {
    id: 'views-menu',
    title: 'Everything else lives in here',
    body: 'The views menu opens the rest of the dashboard: timeline, costs, leaderboard, health. Press ? for every shortcut, or run this tour again from the command palette whenever you like.',
    anchor: '[data-shell="views-menu"]',
    placement: 'bottom',
  },
];

/** The one anchor the shell may not have yet; kept explicit so tests and C3 agree on the contract. */
export const OPTIONAL_ANCHORS: readonly string[] = ['[data-shell="views-menu"]'];

/** Every anchor the shell must provide for the tour to point at real regions. */
export function requiredAnchors(steps: readonly TourStep[] = TOUR_STEPS): string[] {
  return steps
    .map((step) => step.anchor)
    .filter((anchor): anchor is string => anchor !== undefined && !OPTIONAL_ANCHORS.includes(anchor));
}

export function stepById(id: string): TourStep | undefined {
  return TOUR_STEPS.find((step) => step.id === id);
}

/**
 * Task keys in the order a human sees them: the plan's order first, then anything the plan does not
 * mention (a task migrated in from a resumed run, say). The plan is the only stable ordering the UI
 * has; `Object.keys` follows event arrival, which is not what "the first task" should mean.
 */
export function orderedTaskKeys(run: Run | undefined): string[] {
  if (run === undefined) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const spec of run.plan?.tasks ?? []) {
    if (run.tasks[spec.key] !== undefined && !seen.has(spec.key)) {
      seen.add(spec.key);
      keys.push(spec.key);
    }
  }
  for (const key of Object.keys(run.tasks)) {
    if (!seen.has(key)) keys.push(key);
  }
  return keys;
}

/**
 * Which task the drawer step should open: the first one with an agent still at work, else the first
 * task in the run. `undefined` only when the run has no tasks at all — then the step stays centred.
 */
export function drawerTaskKey(run: Run | undefined): string | undefined {
  const keys = orderedTaskKeys(run);
  for (const key of keys) {
    const status = run?.tasks[key]?.status;
    if (status !== undefined && DRAWER_STATUSES.includes(status)) return key;
  }
  return keys[0];
}

/** `drawerTaskKey` against the active run, which is the only run a step may act on. */
export function drawerTaskKeyOf(state: SkyState): string | undefined {
  return drawerTaskKey(activeRunOf(state));
}
