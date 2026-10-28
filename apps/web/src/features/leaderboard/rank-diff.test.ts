import { describe, expect, test } from 'bun:test';
import type { Board, BoardEntry } from './derive';
import {
  describeChange,
  FLIP_EASING,
  flipTranslate,
  flockEasing,
  RANK_BADGE_MS,
  rankChangeList,
  rankChanges,
  rankKey,
} from './rank-diff';

function entry(key: string, value = 1): BoardEntry {
  return { key, label: key, value, display: String(value) };
}

function board(id: string, keys: string[]): Board {
  return { id, title: id, blurb: '', unit: 'tasks', entries: keys.map((key, index) => entry(key, index)) };
}

describe('rankChanges', () => {
  test('reports a swap as +1 and −1', () => {
    const previous = [board('fastest', ['alpha', 'zulu'])];
    const next = [board('fastest', ['zulu', 'alpha'])];
    const changes = rankChanges(previous, next);
    expect(changes.get(rankKey('fastest', 'zulu'))).toBe(1);
    expect(changes.get(rankKey('fastest', 'alpha'))).toBe(-1);
  });

  test('returns an empty map when nothing moved', () => {
    const previous = [board('fastest', ['alpha', 'zulu'])];
    const changes = rankChanges(previous, [board('fastest', ['alpha', 'zulu'])]);
    expect(changes.size).toBe(0);
  });

  test('a debut has no previous rank and is not a move', () => {
    const previous = [board('fastest', ['alpha'])];
    const next = [board('fastest', ['alpha', 'newcomer'])];
    expect(rankChanges(previous, next).size).toBe(0);
  });

  test('an entry that dropped out of the top five has nothing to animate', () => {
    const previous = [board('fastest', ['a', 'b', 'c'])];
    const next = [board('fastest', ['b', 'c'])];
    const changes = rankChanges(previous, next);
    expect(changes.has(rankKey('fastest', 'a'))).toBe(false);
    expect(changes.get(rankKey('fastest', 'b'))).toBe(1);
    expect(changes.get(rankKey('fastest', 'c'))).toBe(1);
  });

  test('boards are independent even when they share an entry key', () => {
    const previous = [board('fastest', ['theme', 'dates']), board('hungriest', ['theme', 'dates'])];
    const next = [board('fastest', ['theme', 'dates']), board('hungriest', ['dates', 'theme'])];
    const changes = rankChanges(previous, next);
    expect(changes.size).toBe(2);
    expect(changes.has(rankKey('fastest', 'theme'))).toBe(false);
    expect(changes.get(rankKey('hungriest', 'theme'))).toBe(-1);
    expect(changes.get(rankKey('hungriest', 'dates'))).toBe(1);
  });

  test('an unknown board on the next snapshot reports nothing', () => {
    expect(rankChanges([board('fastest', ['a', 'b'])], [board('newboard', ['b', 'a'])]).size).toBe(0);
  });

  test('rankChangeList carries from/to/delta in board order', () => {
    const list = rankChangeList([board('fastest', ['a', 'b', 'c'])], [board('fastest', ['c', 'a', 'b'])]);
    expect(list).toEqual([
      { key: 'fastest:c', boardId: 'fastest', entryKey: 'c', from: 3, to: 1, delta: 2 },
      { key: 'fastest:a', boardId: 'fastest', entryKey: 'a', from: 1, to: 2, delta: -1 },
      { key: 'fastest:b', boardId: 'fastest', entryKey: 'b', from: 2, to: 3, delta: -1 },
    ]);
  });
});

describe('motion helpers', () => {
  test('describeChange reads naturally for badges and screen readers', () => {
    expect(describeChange(1)).toBe('up 1 place');
    expect(describeChange(2)).toBe('up 2 places');
    expect(describeChange(-1)).toBe('down 1 place');
    expect(describeChange(-3)).toBe('down 3 places');
    expect(describeChange(0)).toBe('holding position');
  });

  test('flipTranslate starts the row where it used to be', () => {
    expect(flipTranslate(100, 140)).toBe(-40);
    expect(flipTranslate(140, 100)).toBe(40);
    expect(flipTranslate(Number.NaN, 10)).toBe(0);
  });

  test('the badge window and easing are the documented values', () => {
    expect(RANK_BADGE_MS).toBe(2_000);
    expect(FLIP_EASING).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
  });

  test('flockEasing reads --ease-flock and falls back to the token value', () => {
    // No stylesheet in bun/happy-dom: the fallback is the same curve the token declares.
    expect(flockEasing()).toBe(FLIP_EASING);
  });
});
