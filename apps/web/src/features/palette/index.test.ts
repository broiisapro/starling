import { expect, test } from 'bun:test';
import { CommandPalette } from './CommandPalette';
import {
  FEATURE,
  feature,
  flattenGroups,
  formatHotkey,
  fuzzyScore,
  groupResults,
  RECENT_KEY,
  rankItems,
  readRecent,
  taskItems,
} from './index';

test('exports the lane id and the L39 manifest', () => {
  expect(FEATURE).toBe('palette');
  expect(feature.id).toBe('palette');
  expect(feature.title).toBe('Command palette');
  expect(feature.kind).toBe('overlay');
  expect(feature.icon).toBe('Command');
  expect(feature.hotkey).toBe('mod+k');
  expect(feature.Component).toBe(CommandPalette);
});

test('the manifest describes a searchable overlay', () => {
  expect(feature.description.toLowerCase()).toContain('task');
  expect(feature.description.length).toBeLessThan(120);
});

test('the pure building blocks are exported from the feature index', () => {
  expect(typeof fuzzyScore).toBe('function');
  expect(typeof rankItems).toBe('function');
  expect(typeof taskItems).toBe('function');
  expect(typeof groupResults).toBe('function');
  expect(typeof flattenGroups).toBe('function');
  expect(typeof readRecent).toBe('function');
  expect(typeof formatHotkey).toBe('function');
  expect(RECENT_KEY).toBe('starling.palette.recent.v1');
});
