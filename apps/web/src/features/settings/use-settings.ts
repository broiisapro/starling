/**
 * `useSettings()` — the drawer's state and the shell's future bridge (Epic 118).
 *
 * Local state is the truth for this tab; every change is persisted, applied to `<html>` and mirrored
 * from `storage` events so a second tab (a projector view, a laptop next to the hub) follows along.
 * Nothing here reads the Sky store, so the hook is usable from the Playground and from C3's shell.
 */
import { useCallback, useEffect, useState } from 'react';
import { applySettings } from './apply';
import { mergeSettings, SETTINGS_STORAGE_KEY, type SettingsPatch, type StarlingSettings } from './schema';
import { readSettings, type SettingsStorage, writeSettings } from './storage';

export interface UseSettingsOptions {
  /** Injected in tests and workers; defaults to a guarded `localStorage`. */
  storage?: SettingsStorage;
  /**
   * Apply the document attributes on mount and after every change. Default true: a settings change
   * should be visible immediately. Tests that only assert persistence can turn it off.
   */
  apply?: boolean;
}

export type SettingsUpdate = (patch: SettingsPatch) => StarlingSettings;

export type UseSettingsResult = readonly [StarlingSettings, SettingsUpdate];

function currentDocument(): Document | undefined {
  return typeof document === 'undefined' ? undefined : document;
}

export function useSettings(options: UseSettingsOptions = {}): UseSettingsResult {
  const { storage, apply = true } = options;
  const [settings, setSettings] = useState<StarlingSettings>(() => readSettings(storage));

  const update = useCallback<SettingsUpdate>(
    (patch) => {
      const next = mergeSettings(settings, patch);
      setSettings(next);
      writeSettings(next, storage);
      return next;
    },
    [settings, storage],
  );

  useEffect(() => {
    if (!apply) return;
    applySettings(settings, currentDocument());
  }, [apply, settings]);

  useEffect(() => {
    const view = typeof window === 'undefined' ? undefined : window;
    if (view === undefined || typeof view.addEventListener !== 'function') return;
    const onStorage = (event: StorageEvent): void => {
      // `key === null` is a `clear()`; anything else is another tab writing the settings blob.
      if (event.key !== null && event.key !== SETTINGS_STORAGE_KEY) return;
      setSettings(readSettings(storage));
    };
    view.addEventListener('storage', onStorage);
    return () => view.removeEventListener('storage', onStorage);
  }, [storage]);

  return [settings, update] as const;
}
