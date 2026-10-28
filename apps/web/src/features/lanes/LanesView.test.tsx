import { afterEach, describe, expect, test } from 'bun:test';
import { makePlan, makeRun, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';
import { ensureDom } from '../../lib/test-dom';
import { LanesView } from './LanesView';
import { OVERLAP_SUMMARY, overlapScenarioState } from './test-fixtures';

ensureDom();
afterEach(cleanup);

function demoState(): SkyState {
  return applyEvents(createInitialState(), demoEvents());
}

function tile(path: string): Element {
  const found = screen
    .getAllByTestId('lane-tile')
    .find((candidate) => candidate.getAttribute('data-path') === path);
  if (found === undefined) throw new Error(`no lane tile for ${path}`);
  return found;
}

function row(path: string): HTMLElement {
  const found = screen
    .getAllByTestId('lane-row')
    .find((candidate) => candidate.getAttribute('data-path') === path);
  if (found === undefined) throw new Error(`no lane row for ${path}`);
  return found as HTMLElement;
}

/** Two files, so the layout has two focusable tiles with a clear vertical order. */
function twoFileState(): SkyState {
  const plan = makePlan({
    id: 'plan-two-files',
    goalId: 'goal-two-files',
    tasks: [
      makeTaskSpec({ key: 'a', title: 'Alpha', lane: { owns: ['src/alpha.ts'], reads: [] } }),
      makeTaskSpec({ key: 'b', title: 'Beta', lane: { owns: ['src/beta.ts'], reads: [] } }),
    ],
  });
  const run = makeRun({
    id: 'run-two-files',
    plan,
    tasks: {
      a: makeTaskRun({ runId: 'run-two-files', taskKey: 'a' }),
      b: makeTaskRun({ runId: 'run-two-files', taskKey: 'b' }),
    },
  });
  return { ...createInitialState(), runs: { [run.id]: run }, activeRunId: run.id };
}

describe('LanesView', () => {
  test('the recorded run ends with the fixture summary the demo promises', () => {
    render(<LanesView state={demoState()} />);
    expect(screen.getByTestId('lanes-summary').textContent).toBe(
      '7 lanes · 0 overlaps · 8 files touched · 0 conflicts',
    );
  });

  test('the handmade scenario shows its overlap, conflict and violation', () => {
    render(<LanesView state={overlapScenarioState()} />);
    expect(screen.getByTestId('lanes-summary').textContent).toBe(OVERLAP_SUMMARY);
    expect(screen.getByTestId('lanes-warnings').textContent).toContain('theme and search both own src/ui/**');
  });

  test('renders one legend swatch per task with its human title', () => {
    render(<LanesView state={demoState()} />);
    const items = screen.getAllByTestId('lanes-legend-item');
    expect(items).toHaveLength(7);
    expect(items[0]?.textContent).toContain('Dark mode with a toggle');
    expect(items.map((item) => item.getAttribute('data-task-key'))).toContain('dates-fix');
    expect(screen.getByTestId('lanes-legend-readonly').textContent).toContain('read-only');
  });

  test('clicking a tile selects its owning task', () => {
    const selected: string[] = [];
    render(<LanesView state={overlapScenarioState()} onSelectTask={(key) => selected.push(key)} />);

    fireEvent.click(tile('src/features/theme/index.ts'));
    expect(selected).toEqual(['theme']);
  });

  test('the selected task stays bright and the rest dim', () => {
    const state = overlapScenarioState();
    render(<LanesView state={{ ...state, selectedTask: 'theme' }} />);

    expect(tile('src/features/theme/index.ts').getAttribute('data-dim')).toBe('false');
    expect(tile('src/lib/csv.ts').getAttribute('data-dim')).toBe('true');
    expect(tile('src/lib/csv.ts').getAttribute('opacity')).toBe('0.18');
  });

  test('"View as list" renders the same data as a table with flags', () => {
    render(<LanesView state={overlapScenarioState()} />);
    fireEvent.click(screen.getByTestId('lanes-mode-list'));

    expect(screen.getByTestId('lanes-mode-list').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('lanes-table')).toBeDefined();
    expect(screen.queryByTestId('lanes-map')).toBeNull();

    expect(within(row('src/features/theme/index.ts')).getByText('Dark mode')).toBeDefined();
    expect(within(row('src/lib/csv.ts')).getByText('CSV export')).toBeDefined();
    expect(row('src/ui/styles.css').textContent).toContain('conflict');
    expect(row('src/lib/dates.ts').textContent).toContain('violation');
    expect(row('src/ui/styles.css').textContent).toContain('25');
  });

  test('read-only paths are flagged in the list', () => {
    render(<LanesView state={demoState()} />);
    fireEvent.click(screen.getByTestId('lanes-mode-list'));

    expect(row('src/main.ts').textContent).toContain('read-only');
    expect(row('src/main.ts').textContent).toContain('—');
  });

  test('shows the empty state before a plan exists', () => {
    render(<LanesView state={createInitialState()} />);

    expect(screen.getByText('No lanes yet')).toBeDefined();
    expect(screen.queryByTestId('lanes-map')).toBeNull();
    expect(screen.queryByTestId('lanes-legend')).toBeNull();
    expect(screen.getByTestId('lanes-summary').textContent).toBe(
      '0 lanes · 0 overlaps · 0 files touched · 0 conflicts',
    );
  });

  test('a path edited by two tasks is hatched and outlined in red on conflict', () => {
    render(<LanesView state={overlapScenarioState()} />);
    const shared = tile('src/ui/styles.css');

    expect(shared.getAttribute('data-overlap')).toBe('true');
    expect(shared.getAttribute('data-conflict')).toBe('true');
    expect(shared.querySelector('rect[fill^="url(#lanes-hatch"]')).not.toBeNull();
    expect(shared.querySelector('rect')?.getAttribute('stroke')).toBe('#fb7185');
  });

  test('a lane violation is dashed red', () => {
    render(<LanesView state={overlapScenarioState()} />);
    const violated = tile('src/lib/dates.ts');

    expect(violated.getAttribute('data-violation')).toBe('true');
    expect(violated.querySelector('rect')?.getAttribute('stroke')).toBe('#f87171');
    expect(violated.querySelector('rect')?.getAttribute('stroke-dasharray')).toBe('4 3');
  });

  test('read-only tiles are faded', () => {
    render(<LanesView state={demoState()} />);
    const main = tile('src/main.ts');
    expect(main.getAttribute('data-readonly')).toBe('true');
    expect(main.querySelector('rect')?.getAttribute('fill-opacity')).toBe('0.22');
  });

  test('tiles are buttons with exactly one roving tab stop', () => {
    render(<LanesView state={twoFileState()} />);
    const tiles = screen.getAllByTestId('lane-tile');

    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles[0]?.getAttribute('role')).toBe('button');
    expect(tiles.filter((candidate) => candidate.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(tiles.filter((candidate) => candidate.getAttribute('tabindex') === '-1').length).toBe(
      tiles.length - 1,
    );
  });

  test('arrow keys move the roving tab stop inside the map', () => {
    render(<LanesView state={twoFileState()} />);
    const first = screen.getByTestId('lanes-map').querySelector('[tabindex="0"]');
    if (first === null) throw new Error('no active lane tile');
    const firstPath = first.getAttribute('data-path');

    fireEvent.keyDown(first, { key: 'ArrowRight' });

    const active = screen.getByTestId('lanes-map').querySelector('[tabindex="0"]');
    expect(active).not.toBeNull();
    expect(active?.getAttribute('data-path')).not.toBe(firstPath);
  });

  test('respects reduced motion with an explicit data attribute', () => {
    render(<LanesView state={demoState()} />);
    expect(screen.getByTestId('lanes-view').getAttribute('data-reduced-motion')).toBe('false');
  });

  test('the map header explains what the marks mean', () => {
    render(<LanesView state={demoState()} />);
    expect(screen.getByTestId('lanes-view').textContent).toContain('Read-only areas fade');
    expect(screen.getByTestId('lanes-map').getAttribute('aria-label')).toContain('which task owns');
  });
});
