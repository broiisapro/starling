import './test-env';
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { CommandPalette, type CommandPaletteProps } from './CommandPalette';
import {
  CSV_TASK_KEY,
  CSV_TASK_TITLE,
  FEATURES,
  fixtureState,
  stateWithRuns,
  stateWithTasks,
} from './test-fixtures';

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // No storage in a non-browser process.
  }
});

interface Mounted {
  input: HTMLInputElement;
  calls: string[];
  unmount(): void;
}

function mount(overrides: Partial<CommandPaletteProps> = {}): Mounted {
  const calls: string[] = [];
  const props: CommandPaletteProps = {
    state: fixtureState(),
    onSelectTask: (key) => calls.push(`task:${key}`),
    onSelectRun: (id) => calls.push(`run:${id}`),
    onOpenFeature: (id) => calls.push(`feature:${id}`),
    onClose: () => calls.push('close'),
    ...overrides,
  };
  const view = render(<CommandPalette {...props} />);
  const input = screen.getByRole('combobox') as HTMLInputElement;
  return { input, calls, unmount: () => view.unmount() };
}

function activeOptionId(input: HTMLInputElement): string | null {
  return input.getAttribute('aria-activedescendant');
}

describe('ARIA and structure', () => {
  test('the input is a combobox wired to the listbox and the active option', () => {
    const { input } = mount();
    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');

    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    expect(options.length).toBeGreaterThan(0);
    expect(activeOptionId(input)).toBe(options[0]?.id ?? null);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(input);
  });

  test('results are grouped with labelled group headings', () => {
    mount();
    expect(screen.getByTestId('palette-group-tasks')).toBeTruthy();
    expect(screen.getByTestId('palette-group-runs')).toBeTruthy();
    expect(screen.getAllByRole('group').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Tasks')).toBeTruthy();
    expect(screen.getByText('Runs')).toBeTruthy();
  });

  test('reports the result count to assistive technology', () => {
    mount();
    const total = screen.getAllByRole('option').length;
    expect(screen.getByTestId('palette-count').textContent).toContain(String(total));
    expect(screen.getAllByRole('status')[0]?.textContent).toContain(String(total));
  });
});

describe('keyboard', () => {
  const COMMANDS = [
    { id: 'one', label: 'Command one', run: () => {} },
    { id: 'two', label: 'Command two', run: () => {} },
    { id: 'three', label: 'Command three', run: () => {} },
  ];

  test('arrow keys wrap at both ends', () => {
    const { input } = mount({ state: stateWithRuns([]), commands: COMMANDS });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeOptionId(input)).toBe(options[2]?.id ?? null);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeOptionId(input)).toBe(options[0]?.id ?? null);
  });

  test('Home and End jump to the first and last option', () => {
    const { input } = mount({ state: stateWithRuns([]), commands: COMMANDS });
    const options = screen.getAllByRole('option');

    fireEvent.keyDown(input, { key: 'End' });
    expect(activeOptionId(input)).toBe(options[2]?.id ?? null);

    fireEvent.keyDown(input, { key: 'Home' });
    expect(activeOptionId(input)).toBe(options[0]?.id ?? null);
  });

  test('Enter runs the active item and then closes', () => {
    const picked: string[] = [];
    const { input, calls } = mount({
      state: stateWithRuns([]),
      commands: [{ id: 'one', label: 'Only command', run: () => picked.push('run:one') }],
    });

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(picked).toEqual(['run:one']);
    expect(calls).toEqual(['close']);
  });

  test('Escape closes without running anything', () => {
    const picked: string[] = [];
    const { input, calls } = mount({
      state: stateWithRuns([]),
      commands: [{ id: 'one', label: 'Only command', run: () => picked.push('run:one') }],
    });

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(picked).toEqual([]);
    expect(calls).toEqual(['close']);
  });

  test('Tab does not escape the dialog', () => {
    const { input } = mount();
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  test('a click picks the row with the mouse', () => {
    const picked: string[] = [];
    const { calls } = mount({
      state: stateWithRuns([]),
      commands: [{ id: 'one', label: 'Only command', run: () => picked.push('run:one') }],
    });
    fireEvent.click(screen.getAllByRole('option')[0] as HTMLElement);
    expect(picked).toEqual(['run:one']);
    expect(calls).toEqual(['close']);
  });
});

describe('recents', () => {
  test('the last picks come first when the query is empty', () => {
    mount({ initialRecent: ['task:csv-export', 'feature:report'], features: FEATURES });
    const options = screen.getAllByRole('option');

    expect(screen.getByTestId('palette-group-recent')).toBeTruthy();
    expect(options[0]?.textContent).toContain(CSV_TASK_TITLE);
    expect(options[1]?.textContent).toContain('Run report');
  });

  test('recents disappear as soon as a query is typed', () => {
    const { input } = mount({ initialRecent: ['task:csv-export'], features: FEATURES });
    expect(screen.getByTestId('palette-group-recent')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'csv' } });
    expect(screen.queryByTestId('palette-group-recent')).toBeNull();
  });

  test('a stale stored id is ignored', () => {
    mount({ initialRecent: ['task:deleted-yesterday', 'run:gone'] });
    expect(screen.queryByTestId('palette-group-recent')).toBeNull();
  });

  test('picking an item persists it to localStorage', () => {
    const { input } = mount({
      state: stateWithRuns([]),
      commands: [{ id: 'one', label: 'Only command', run: () => {} }],
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(localStorage.getItem('starling.palette.recent.v1')).toBe(JSON.stringify(['command:one']));
  });
});

describe('features and search', () => {
  test('the views group only exists when manifests are passed', () => {
    const bare = mount();
    fireEvent.change(bare.input, { target: { value: 'costs' } });
    expect(screen.queryByTestId('palette-group-features')).toBeNull();
    bare.unmount();

    const withFeatures = mount({ features: FEATURES });
    fireEvent.change(withFeatures.input, { target: { value: 'costs' } });
    const group = screen.getByTestId('palette-group-features');
    expect(within(group).getByRole('option').textContent).toContain('Costs');
  });

  test('typing csv puts the csv-export task on top; Enter selects it and closes', () => {
    const { input, calls } = mount();
    fireEvent.change(input, { target: { value: 'csv' } });

    const options = screen.getAllByRole('option');
    expect(options[0]?.textContent).toContain(CSV_TASK_TITLE);

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(calls).toEqual([`task:${CSV_TASK_KEY}`, 'close']);
  });

  test('matched ranges are highlighted in the row', () => {
    const { input } = mount();
    fireEvent.change(input, { target: { value: 'csv' } });

    const marks = screen.getAllByRole('option')[0]?.querySelectorAll('mark');
    expect(marks?.length).toBe(1);
    expect(marks?.[0]?.textContent).toBe('CSV');
  });

  test('shows an empty message when nothing matches', () => {
    const { input } = mount();
    fireEvent.change(input, { target: { value: 'zzzzzzz' } });
    expect(screen.getByTestId('palette-empty')).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  test('a 500-task plan renders at most 50 rows and filters down to one', () => {
    const { input } = mount({ state: stateWithTasks(500) });
    expect(screen.getAllByRole('option')).toHaveLength(50);
    expect(screen.getByTestId('palette-count').textContent).toContain('50 results');

    fireEvent.change(input, { target: { value: 'number 499' } });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain('Task number 499');
  });
});

describe('focus', () => {
  test('closing restores focus to the trigger', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open palette';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = mount();
    expect(document.activeElement).not.toBe(trigger);

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
