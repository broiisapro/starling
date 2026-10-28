import { afterEach, describe, expect, test } from 'bun:test';
import { BASE_TS, makeGoal, makeRun } from '@starling/core/testing';
import { collectItems, flattenGroups, GROUP_LABELS, groupResults, rangesFor } from './derive';
import { formatHotkey } from './hotkey';
import { commandItems, featureItems, type PaletteItem, recentItems, runItems, taskItems } from './items';
import {
  parseRecent,
  pruneRecent,
  RECENT_KEY,
  RECENT_LIMIT,
  type RecentStorage,
  readRecent,
  recordRecent,
  writeRecent,
} from './recent';
import {
  CSV_TASK_KEY,
  CSV_TASK_TITLE,
  FEATURES,
  fixtureState,
  stateWithRuns,
  stateWithTasks,
} from './test-fixtures';

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // A non-browser test process has no localStorage; nothing to clear.
  }
});

function memoryStorage(
  initial: Record<string, string> = {},
): RecentStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('item builders', () => {
  test('tasks come from the active run plan with key, status label and a select callback', () => {
    const state = fixtureState();
    const picked: string[] = [];
    const items = taskItems(state, (key) => picked.push(key));

    expect(items).toHaveLength(7);
    const theme = items[0];
    expect(theme?.id).toBe('task:theme');
    expect(theme?.group).toBe('tasks');
    expect(theme?.label).toBe('Dark mode with a toggle');
    expect(theme?.hint).toBe('theme · Landed');

    const csv = items.find((item) => item.id === `task:${CSV_TASK_KEY}`);
    expect(csv?.label).toBe(CSV_TASK_TITLE);

    csv?.run();
    expect(picked).toEqual([CSV_TASK_KEY]);
  });

  test('a task that has not started still appears, with the pending label', () => {
    const state = fixtureState();
    const items = taskItems(state);
    const pending = { ...state };
    // An empty task map is a plan that has not dispatched anything yet.
    pending.runs = { ...state.runs };
    const run = pending.runs[state.activeRunId ?? ''];
    if (run === undefined) throw new Error('fixture run missing');
    pending.runs[run.id] = { ...run, tasks: {} };

    const fresh = taskItems(pending);
    expect(fresh).toHaveLength(items.length);
    expect(fresh[0]?.hint).toBe('theme · Pending');
  });

  test('no active run means no task items', () => {
    expect(taskItems({ ...fixtureState(), activeRunId: undefined, runs: {} })).toEqual([]);
  });

  test('runs are newest first, labelled with the goal and hinted with the status', () => {
    const older = makeRun({
      goal: makeGoal({ text: 'Older goal', createdAt: BASE_TS }),
      startedAt: BASE_TS,
      status: 'finished',
    });
    const newer = makeRun({
      goal: makeGoal({ text: 'Newer goal', createdAt: BASE_TS + 1_000 }),
      startedAt: BASE_TS + 1_000,
      status: 'running',
    });
    const state = stateWithRuns([older, newer]);
    const picked: string[] = [];
    const items = runItems(state, (id) => picked.push(id));

    expect(items.map((item) => item.label)).toEqual(['Newer goal', 'Older goal']);
    expect(items[0]?.hint).toBe('running');
    expect(items[0]?.id).toBe(`run:${newer.id}`);
    items[0]?.run();
    expect(picked).toEqual([newer.id]);
  });

  test('feature items mirror the manifest (title, description, hotkey, id)', () => {
    const opened: string[] = [];
    const items = featureItems(FEATURES, (id) => opened.push(id));

    expect(items).toHaveLength(3);
    expect(items[0]?.id).toBe('feature:report');
    expect(items[0]?.label).toBe('Run report');
    expect(items[0]?.hint).toBe('What happened, in prose');
    expect(items[0]?.hotkey).toBe('r');
    expect(items[2]?.hotkey).toBeUndefined();

    items[2]?.run();
    expect(opened).toEqual(['costs']);
  });

  test('command items keep their run action and optional hint/hotkey', () => {
    const calls: string[] = [];
    const items = commandItems([
      {
        id: 'theme',
        label: 'Toggle theme',
        hint: 'Light or dark',
        hotkey: ',',
        run: () => calls.push('theme'),
      },
      { id: 'speed', label: 'Demo speed 4×', run: () => calls.push('speed') },
    ]);

    expect(items[0]?.id).toBe('command:theme');
    expect(items[0]?.group).toBe('commands');
    expect(items[1]?.hint).toBeUndefined();
    items[0]?.run();
    expect(calls).toEqual(['theme']);
  });

  test('recent items follow the stored order, drop unknown ids and are re-grouped', () => {
    const items: PaletteItem[] = commandItems([
      { id: 'a', label: 'Alpha', run: () => {} },
      { id: 'b', label: 'Beta', run: () => {} },
    ]);
    const recents = recentItems(items, ['command:b', 'command:missing', 'command:a']);
    expect(recents.map((item) => item.id)).toEqual(['command:b', 'command:a']);
    expect(recents.every((item) => item.group === 'recent')).toBe(true);
  });
});

describe('recent storage', () => {
  test('recordRecent moves a pick to the front, de-duplicates and caps at eight', () => {
    let ids: string[] = [];
    for (let index = 0; index < 10; index += 1) ids = recordRecent(ids, `id-${index}`);

    expect(ids).toHaveLength(RECENT_LIMIT);
    expect(ids[0]).toBe('id-9');
    expect(recordRecent(ids, 'id-5')[0]).toBe('id-5');
    expect(recordRecent(ids, 'id-5')).toHaveLength(RECENT_LIMIT);
    expect(new Set(recordRecent(ids, 'id-5')).size).toBe(RECENT_LIMIT);
  });

  test('read/write round-trips through a storage of the caller’s choosing', () => {
    const storage = memoryStorage();
    writeRecent(['command:theme', 'task:theme'], storage);
    expect(storage.values.get(RECENT_KEY)).toBe(JSON.stringify(['command:theme', 'task:theme']));
    expect(readRecent(storage)).toEqual(['command:theme', 'task:theme']);
  });

  test('a throwing storage degrades to an empty history instead of failing', () => {
    const broken: RecentStorage = {
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => {
        throw new Error('private mode');
      },
    };
    expect(readRecent(broken)).toEqual([]);
    expect(() => writeRecent(['task:theme'], broken)).not.toThrow();
  });

  test('garbage in storage is ignored safely', () => {
    expect(parseRecent('not json')).toEqual([]);
    expect(parseRecent('{"not":"an array"}')).toEqual([]);
    expect(parseRecent('[1,"ok","ok","",null]')).toEqual(['ok']);
    expect(parseRecent(null)).toEqual([]);
  });

  test('pruneRecent drops ids that no longer exist', () => {
    const valid = new Set(['command:a', 'task:b']);
    expect(pruneRecent(['command:a', 'task:gone', 'task:b'], valid)).toEqual(['command:a', 'task:b']);
  });
});

describe('groupResults', () => {
  const items = collectItems({
    state: fixtureState(),
    features: FEATURES,
    commands: [{ id: 'theme', label: 'Toggle theme', run: () => {} }],
  });

  test('an empty query shows recent first, then the stable group order', () => {
    const groups = groupResults(items, '', ['task:theme', 'feature:report']);
    expect(groups.map((group) => group.id)).toEqual(['recent', 'commands', 'features', 'tasks', 'runs']);
    expect(groups[0]?.items.map((entry) => entry.item.id)).toEqual(['task:theme', 'feature:report']);
    expect(groups.every((group) => group.label === GROUP_LABELS[group.id])).toBe(true);
  });

  test('no recents means no recent group', () => {
    const groups = groupResults(items, '', []);
    expect(groups.map((group) => group.id)).toEqual(['commands', 'features', 'tasks', 'runs']);
  });

  test('a query ranks across groups and keeps the heading order', () => {
    const groups = groupResults(items, 'csv', []);
    expect(groups.map((group) => group.id)).toEqual(['tasks', 'runs']);
    expect(groups[0]?.items[0]?.item.id).toBe(`task:${CSV_TASK_KEY}`);
    expect(groups.every((group) => group.items.length > 0)).toBe(true);
  });

  test('recent picks are not shown while searching', () => {
    const groups = groupResults(items, 'csv', ['task:csv-export']);
    expect(groups.map((group) => group.id)).not.toContain('recent');
  });

  test('caps the render at 50 rows for a 500-task plan', () => {
    const big = collectItems({ state: stateWithTasks(500) });
    expect(big).toHaveLength(501);
    expect(groupResults(big, '', [], 50).flatMap((group) => group.items)).toHaveLength(50);
    expect(groupResults(big, 'task number', [], 50).flatMap((group) => group.items)).toHaveLength(50);
  });

  test('flattenGroups follows group then row order, and rangesFor finds the label spans', () => {
    const groups = groupResults(items, 'csv', []);
    const flat = flattenGroups(groups);
    expect(flat[0]?.id).toBe(`task:${CSV_TASK_KEY}`);
    expect(rangesFor(groups, `task:${CSV_TASK_KEY}`)).toEqual([[0, 3]]);
    expect(rangesFor(groups, 'task:missing')).toEqual([]);
  });

  test('a query with no matches yields no groups', () => {
    expect(groupResults(items, 'zzzzz', [])).toEqual([]);
  });
});

describe('hotkey hints', () => {
  test('formats mod+key for Mac and everyone else', () => {
    expect(formatHotkey('mod+k', 'mac')).toBe('⌘K');
    expect(formatHotkey('mod+k', 'other')).toBe('Ctrl K');
  });

  test('keeps single-character and symbol hotkeys literal', () => {
    expect(formatHotkey('L', 'mac')).toBe('L');
    expect(formatHotkey('`', 'other')).toBe('`');
    expect(formatHotkey('.', 'mac')).toBe('.');
    expect(formatHotkey('!', 'other')).toBe('!');
  });

  test('formats modifier chords', () => {
    expect(formatHotkey('shift+enter', 'mac')).toBe('⇧↵');
    expect(formatHotkey('shift+enter', 'other')).toBe('Shift Enter');
  });
});
