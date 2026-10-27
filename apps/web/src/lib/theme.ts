/** Dark-by-default theme with a light toggle, persisted in localStorage. */

export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'starling.theme';

/** Minimal storage surface so tests can pass a fake and the server can render without one. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ThemeStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    // Safari private mode and some embedded webviews throw on access. Dark default still works.
    return undefined;
  }
}

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

export function readTheme(storage: ThemeStorage | undefined = defaultStorage()): Theme {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'dark';
  } catch {
    return 'dark';
  }
}

export function writeTheme(theme: Theme, storage: ThemeStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Persistence is a convenience; failing to save a theme must never break the dashboard.
  }
}

/** Applies the theme to <html data-theme="…">, which every CSS token keys off. */
export function applyTheme(
  theme: Theme,
  root: HTMLElement | undefined = globalThis.document?.documentElement,
): void {
  if (root === undefined) return;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

/** Read → flip → apply → persist. Returns the new theme so React state can follow. */
export function toggleTheme(
  current: Theme,
  options: { root?: HTMLElement; storage?: ThemeStorage } = {},
): Theme {
  const next = nextTheme(current);
  applyTheme(next, options.root);
  writeTheme(next, options.storage);
  return next;
}
