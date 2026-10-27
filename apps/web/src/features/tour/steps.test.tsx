import { afterEach, describe, expect, test } from 'bun:test';
import { ensureDom } from '../../lib/test-dom';

ensureDom();
const { cleanup, render } = await import('@testing-library/react');

const {
  drawerTaskKey,
  drawerTaskKeyOf,
  OPTIONAL_ANCHORS,
  orderedTaskKeys,
  requiredAnchors,
  stepById,
  TOUR_STEPS,
} = await import('./steps');
const { ShellMock } = await import('./ShellMock');
const { createInitialState } = await import('../../data/reducer');
const { activeRunOf } = await import('../../data/selectors');
const { demoStateAt } = await import('./test-support');

afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});

const PLACEMENTS = new Set(['top', 'bottom', 'left', 'right', 'center']);

describe('TOUR_STEPS', () => {
  test('has seven pages with unique ids, real copy and valid placements', () => {
    expect(TOUR_STEPS).toHaveLength(7);
    expect(new Set(TOUR_STEPS.map((step) => step.id)).size).toBe(7);
    for (const step of TOUR_STEPS) {
      expect(step.id.length).toBeGreaterThan(2);
      expect(step.title.length).toBeGreaterThan(4);
      expect(step.body.length).toBeGreaterThan(40);
      expect(PLACEMENTS.has(step.placement)).toBe(true);
      expect(step.title).not.toBe(step.body);
    }
  });

  test('names the product story a judge needs: lanes, audits, merge queue, local cost', () => {
    const copy = TOUR_STEPS.map((step) => `${step.title} ${step.body}`)
      .join(' ')
      .toLowerCase();
    for (const word of ['lane', 'audit', 'queue', 'local']) expect(copy).toContain(word);
  });

  test('only the views menu is optional, and it is the last step', () => {
    expect(OPTIONAL_ANCHORS).toEqual(['[data-shell="views-menu"]']);
    expect(TOUR_STEPS.at(-1)?.anchor).toBe('[data-shell="views-menu"]');
    expect(requiredAnchors()).toHaveLength(6);
    expect(requiredAnchors()).not.toContain('[data-shell="views-menu"]');
  });

  test('every required anchor exists in the mock of the real shell', () => {
    const view = render(<ShellMock state={demoStateAt(160)} selectedTask="search" />);
    for (const anchor of requiredAnchors()) {
      expect(view.container.querySelector(anchor), `missing anchor ${anchor}`).not.toBeNull();
    }
    expect(view.container.querySelector('[data-shell="views-menu"]')).not.toBeNull();
  });

  test('the fallback toggle really removes two anchors', () => {
    const view = render(<ShellMock state={demoStateAt(160)} showAllAnchors={false} />);
    expect(view.container.querySelector('[data-shell="views-menu"]')).toBeNull();
    expect(view.container.querySelector('[data-region="metrics"]')).toBeNull();
    expect(view.container.querySelector('[data-region="sky"]')).not.toBeNull();
  });

  test('stepById finds a step and misses cleanly', () => {
    expect(stepById('queue')?.title).toContain('landing');
    expect(stepById('nope')).toBeUndefined();
  });
});

describe('drawer target', () => {
  test('picks the first task with an agent at work', () => {
    const state = demoStateAt(160);
    // Plan order is theme, search, …: theme has landed by event 160, search is still running.
    expect(drawerTaskKeyOf(state)).toBe('search');
  });

  test('prefers an active task over an earlier terminal one', () => {
    const state = demoStateAt(80); // theme still running, csv-export just merged
    expect(drawerTaskKeyOf(state)).toBe('theme');
  });

  test('falls back to the first task in plan order when everything is terminal', () => {
    const state = demoStateAt(252);
    expect(drawerTaskKeyOf(state)).toBe('theme');
  });

  test('returns undefined without a run or without tasks', () => {
    expect(drawerTaskKeyOf(createInitialState())).toBeUndefined();
    expect(drawerTaskKey(undefined)).toBeUndefined();
    const run = activeRunOf(demoStateAt(1));
    if (run === undefined) throw new Error('fixture did not create a run');
    expect(drawerTaskKey({ ...run, tasks: {} })).toBeUndefined();
  });

  test('keeps plan order and appends tasks the plan does not mention', () => {
    const run = activeRunOf(demoStateAt(40));
    if (run === undefined) throw new Error('fixture did not create a run');
    const keys = orderedTaskKeys(run);
    expect(keys.slice(0, 7)).toEqual(run.plan?.tasks.map((task) => task.key) ?? []);
    const first = keys[0];
    const seed = first === undefined ? undefined : run.tasks[first];
    if (seed === undefined) throw new Error('fixture has no tasks');
    const withStray = { ...run, tasks: { ...run.tasks, stray: seed } };
    // A resumed run can carry a task the current plan does not list; it still has a drawer.
    expect(orderedTaskKeys(withStray).at(-1)).toBe('stray');
  });
});
