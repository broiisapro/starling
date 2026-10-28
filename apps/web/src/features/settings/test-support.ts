/** Test-only helpers for the settings lane. Not a test file (Bun only runs `*.test.*`). */
import type { SettingsStorage } from './storage';

export interface MemoryStorage extends SettingsStorage {
  data: Record<string, string>;
}

/** A deterministic `localStorage` stand-in: no globals, no cross-test bleed. */
export function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

/** Safari-private-mode behaviour: every access throws. */
export const throwingStorage: SettingsStorage = {
  getItem() {
    throw new Error('storage denied');
  },
  setItem() {
    throw new Error('storage denied');
  },
  removeItem() {
    throw new Error('storage denied');
  },
};

/** Put `<html>` back to a neutral state between DOM tests. */
export function resetDocument(): void {
  const root = document.documentElement;
  delete root.dataset.theme;
  delete root.dataset.motion;
  delete root.dataset.density;
  root.style.colorScheme = '';
}
