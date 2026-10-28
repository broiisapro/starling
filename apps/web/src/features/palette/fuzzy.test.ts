import { describe, expect, test } from 'bun:test';
import { fuzzyScore, rankItems } from './fuzzy';

describe('fuzzyScore', () => {
  test('an empty or whitespace query matches everything with no ranges', () => {
    expect(fuzzyScore('', 'CSV export')).toEqual({ score: 0, ranges: [] });
    expect(fuzzyScore('   ', 'CSV export')).toEqual({ score: 0, ranges: [] });
  });

  test('a non-subsequence does not match', () => {
    expect(fuzzyScore('xyz', 'CSV export')).toBeUndefined();
    expect(fuzzyScore('exportcsv', 'CSV export')).toBeUndefined();
  });

  test('matching is case-insensitive and trims the query', () => {
    expect(fuzzyScore('CSV', 'csv export')).toEqual(fuzzyScore('csv', 'CSV export'));
    expect(fuzzyScore('  csv  ', 'CSV export')?.ranges).toEqual([[0, 3]]);
  });

  test('a prefix match beats the same letters later in the text', () => {
    const prefix = fuzzyScore('csv', 'CSV export');
    const middle = fuzzyScore('csv', 'Add a CSV export');
    expect(prefix).toBeDefined();
    expect(middle).toBeDefined();
    if (prefix === undefined || middle === undefined) return;
    expect(prefix.score).toBeGreaterThan(middle.score);
  });

  test('a word start beats the same letters inside a word', () => {
    const wordStart = fuzzyScore('csv', 'Add CSV export');
    const insideWord = fuzzyScore('csv', 'AddXCsvExport');
    expect(wordStart).toBeDefined();
    expect(insideWord).toBeDefined();
    if (wordStart === undefined || insideWord === undefined) return;
    expect(wordStart.score).toBeGreaterThan(insideWord.score);
  });

  test('consecutive letters beat the same letters scattered', () => {
    const consecutive = fuzzyScore('abc', 'zabcd');
    const scattered = fuzzyScore('abc', 'zazbzc');
    expect(consecutive).toBeDefined();
    expect(scattered).toBeDefined();
    if (consecutive === undefined || scattered === undefined) return;
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  test('an earlier match beats a later one', () => {
    const early = fuzzyScore('a', 'a long label');
    const late = fuzzyScore('a', 'zzzz a');
    expect(early).toBeDefined();
    expect(late).toBeDefined();
    if (early === undefined || late === undefined) return;
    expect(early.score).toBeGreaterThan(late.score);
  });

  test('finds the best alignment, not the greedy left-to-right one', () => {
    // Greedy would take a(1), b(3), c(5). The consecutive tail at 7,8,9 scores better.
    expect(fuzzyScore('abc', 'zaxbxcxabc')?.ranges).toEqual([[7, 10]]);
  });

  test('merges adjacent positions into half-open ranges', () => {
    expect(fuzzyScore('csv', 'CSV export')?.ranges).toEqual([[0, 3]]);
    expect(fuzzyScore('dv', 'Dark violet')?.ranges).toEqual([
      [0, 1],
      [5, 6],
    ]);
    expect(fuzzyScore('dle', 'middle')?.ranges).toEqual([[3, 6]]);
  });

  test('the same query on the same text is stable', () => {
    const first = fuzzyScore('theme', 'Dark mode with a toggle');
    const second = fuzzyScore('theme', 'Dark mode with a toggle');
    expect(first).toEqual(second);
  });
});

interface Item {
  id: string;
  label: string;
  hint?: string;
  keywords?: readonly string[];
}

const ITEMS: readonly Item[] = [
  { id: 'archive', label: 'Archive the run' },
  { id: 'csv', label: 'CSV export' },
  { id: 'date', label: 'Fix date sorting' },
];

describe('rankItems', () => {
  test('an empty query keeps the input order and applies the limit', () => {
    const ranked = rankItems('', ITEMS, 2);
    expect(ranked.map((entry) => entry.item.id)).toEqual(['archive', 'csv']);
    expect(ranked.every((entry) => entry.score === 0 && entry.ranges.length === 0)).toBe(true);
  });

  test('orders by score, best first', () => {
    const ranked = rankItems('csv', ITEMS);
    expect(ranked.map((entry) => entry.item.id)).toEqual(['csv']);
    expect(ranked[0]?.ranges).toEqual([[0, 3]]);
  });

  test('breaks equal scores by lower-cased label', () => {
    const items: Item[] = [
      { id: 'b', label: 'bx' },
      { id: 'a', label: 'ax' },
    ];
    expect(rankItems('x', items).map((entry) => entry.item.id)).toEqual(['a', 'b']);
  });

  test('breaks equal labels by id, so the order never depends on object order', () => {
    const items: Item[] = [
      { id: 'z', label: 'Same' },
      { id: 'a', label: 'Same' },
    ];
    expect(rankItems('s', items).map((entry) => entry.item.id)).toEqual(['a', 'z']);
  });

  test('respects the limit', () => {
    expect(rankItems('', ITEMS, 1)).toHaveLength(1);
    expect(rankItems('', ITEMS, 0)).toEqual([]);
  });

  test('a keyword surfaces an item whose label does not match, with no label ranges', () => {
    const items: Item[] = [
      { id: 'colour', label: 'Colour scheme', keywords: ['theme'] },
      { id: 'other', label: 'Something else' },
    ];
    const ranked = rankItems('theme', items);
    expect(ranked.map((entry) => entry.item.id)).toEqual(['colour']);
    expect(ranked[0]?.ranges).toEqual([]);
  });

  test('a hint is searchable too', () => {
    const items: Item[] = [{ id: 'mode', label: 'Untitled', hint: 'dark mode' }];
    expect(rankItems('dark', items).map((entry) => entry.item.id)).toEqual(['mode']);
  });

  test('a label match outranks an equal keyword match', () => {
    const items: Item[] = [
      { id: 'keyword', label: 'Something else', keywords: ['theme'] },
      { id: 'label', label: 'Theme' },
    ];
    expect(rankItems('theme', items)[0]?.item.id).toBe('label');
  });

  test('drops items that do not match at all', () => {
    expect(rankItems('zzz', ITEMS)).toEqual([]);
  });
});
