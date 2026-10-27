import { describe, expect, test } from 'bun:test';
import { cn } from './cn';
import {
  formatClock,
  formatDuration,
  formatRelative,
  formatTokens,
  formatUsd,
  percent,
  totalTokens,
} from './format';
import { DEFAULT_ROUTE, initialSpeed, parseRoute } from './route';
import { isDemoSpeed, otherSpeeds, parseDemoSpeed } from './speed';
import {
  isTerminalStatus,
  STATUS_COLORS,
  statusLabel,
  statusPalette,
  TASK_STATUSES,
  TERMINAL_STATUSES,
} from './status';
import type { ThemeStorage } from './theme';
import {
  applyTheme,
  isTheme,
  nextTheme,
  readTheme,
  THEME_STORAGE_KEY,
  toggleTheme,
  writeTheme,
} from './theme';

function memoryStorage(initial?: string): ThemeStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key: string) {
      return key === THEME_STORAGE_KEY ? this.value : null;
    },
    setItem(key: string, next: string) {
      if (key === THEME_STORAGE_KEY) this.value = next;
    },
  };
}

function fakeRoot(): HTMLElement {
  return { dataset: {}, style: {} } as unknown as HTMLElement;
}

describe('status palette', () => {
  test('covers every TaskStatus exactly once', () => {
    expect(TASK_STATUSES).toHaveLength(10);
    expect(new Set(TASK_STATUSES).size).toBe(10);
    for (const status of TASK_STATUSES) {
      expect(STATUS_COLORS[status]).toBeDefined();
      expect(statusLabel(status).length).toBeGreaterThan(0);
      expect(statusPalette(status).hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(statusPalette(status).description.length).toBeGreaterThan(0);
    }
  });

  test('distinguishes statuses by colour and label', () => {
    const hexes = TASK_STATUSES.map((status) => STATUS_COLORS[status].hex);
    expect(new Set(hexes).size).toBe(hexes.length);
    const labels = TASK_STATUSES.map((status) => STATUS_COLORS[status].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('knows which statuses are terminal', () => {
    expect(TERMINAL_STATUSES).toEqual(['merged', 'failed', 'conflict', 'cancelled']);
    expect(isTerminalStatus('merged')).toBe(true);
    expect(isTerminalStatus('fixing')).toBe(false);
  });
});

describe('formatting', () => {
  test('durations read like a demo script', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(356_000)).toBe('5m 56s');
    expect(formatDuration(3_600_000)).toBe('1h 00m');
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });

  test('dollars keep the cents that matter', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0309648)).toBe('$0.031');
    expect(formatUsd(0.005)).toBe('$0.005');
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(Number.NaN)).toBe('$0.00');
  });

  test('token counts stay short', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12_400)).toBe('12.4k');
    expect(formatTokens(1_200_000)).toBe('1.2M');
    expect(formatTokens(-4)).toBe('0');
    expect(totalTokens({ input: 10, output: 20, cached: 30 })).toBe(60);
  });

  test('relative times take an explicit clock', () => {
    const now = 1_700_000_000_000;
    expect(formatRelative(now, now)).toBe('now');
    expect(formatRelative(now - 3_000, now)).toBe('3s ago');
    expect(formatRelative(now - 120_000, now)).toBe('2m ago');
    expect(formatRelative(now + 3_600_000, now)).toBe('1h from now');
  });

  test('percent clamps', () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(1, 4)).toBe(25);
    expect(percent(9, 4)).toBe(100);
    expect(percent(-2, 4)).toBe(0);
  });

  test('formatClock is zero-padded wall-clock time', () => {
    const ts = new Date(2026, 0, 2, 3, 4, 5).getTime();
    expect(formatClock(ts)).toBe('03:04:05');
  });

  test('cn joins truthy class names only', () => {
    expect(cn('a', false, undefined, 'b', null, '')).toBe('a b');
  });
});

describe('route parsing', () => {
  test('?demo=1 forces demo, without a speed', () => {
    expect(parseRoute('?demo=1')).toEqual({ demo: true });
    expect(parseRoute('?demo=true')).toEqual({ demo: true });
  });

  test('reads speed and run id from the query', () => {
    expect(parseRoute('?speed=4&run=abc')).toEqual({ speed: 4, runId: 'abc' });
  });

  test('ignores invalid speeds', () => {
    expect(parseRoute('?speed=3')).toEqual({});
    expect(initialSpeed(DEFAULT_ROUTE)).toBe(1);
  });

  test('accepts hash routes for demo and a run', () => {
    expect(parseRoute('', '#/demo')).toEqual({ demo: true });
    expect(parseRoute('', '#/runs/01abc')).toEqual({ runId: '01abc' });
  });

  test('?demo=0 forces live mode', () => {
    expect(parseRoute('?demo=0')).toEqual({ demo: false });
  });
});

describe('theme', () => {
  test('defaults to dark and reads a stored choice', () => {
    expect(readTheme(memoryStorage())).toBe('dark');
    expect(readTheme(memoryStorage('light'))).toBe('light');
    expect(readTheme(memoryStorage('neon'))).toBe('dark');
  });

  test('applies data-theme and color-scheme to the root', () => {
    const root = fakeRoot();
    applyTheme('light', root);
    expect(root.dataset.theme).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });

  test('toggle flips, applies and persists', () => {
    const root = fakeRoot();
    const storage = memoryStorage();
    expect(toggleTheme('dark', { root, storage })).toBe('light');
    expect(root.dataset.theme).toBe('light');
    expect(storage.value).toBe('light');
    expect(toggleTheme('light', { root, storage })).toBe('dark');
  });

  test('isTheme / nextTheme / writeTheme behave', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('sepia')).toBe(false);
    expect(nextTheme('light')).toBe('dark');
    const storage = memoryStorage();
    writeTheme('light', storage);
    expect(storage.value).toBe('light');

    const broken: ThemeStorage = {
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => {
        throw new Error('private mode');
      },
    };
    expect(readTheme(broken)).toBe('dark');
    expect(() => writeTheme('light', broken)).not.toThrow();
  });
});

describe('demo speed', () => {
  test('accepts only 1, 4 and 16', () => {
    expect(isDemoSpeed(1)).toBe(true);
    expect(isDemoSpeed(2)).toBe(false);
    expect(parseDemoSpeed('4')).toBe(4);
    expect(parseDemoSpeed('16')).toBe(16);
    expect(parseDemoSpeed('3')).toBeUndefined();
    expect(parseDemoSpeed(null)).toBeUndefined();
    expect(otherSpeeds(4)).toEqual([1, 16]);
  });
});
