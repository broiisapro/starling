/**
 * Applying settings to the document (Epic 118).
 *
 * Everything is an attribute on `<html>` so CSS owns the appearance and React owns nothing:
 *
 * - `data-theme="dark|light"` — `system` is resolved here via `prefers-color-scheme`.
 * - `data-motion="reduced|full"` — absent for `system`, which leaves the OS media query in charge.
 * - `data-density="comfortable|compact"` — Epic 112 adds the spacing rules; until then the attribute
 *   is inert, which is the point of shipping the contract before the styling.
 *
 * Pure enough to unit-test with a fake document, and safe to call when there is no DOM.
 */
import type { StarlingSettings, ThemeSetting } from './schema';

export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

export type ResolvedTheme = 'dark' | 'light';

/**
 * `dark` / `light` pass through; `system` asks the document's window. Without a media-query API
 * (server render, an exotic test harness) dark wins, matching the dashboard's default.
 */
export function resolveTheme(
  theme: ThemeSetting,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): ResolvedTheme {
  if (theme === 'dark' || theme === 'light') return theme;
  const view = doc?.defaultView;
  if (view === null || view === undefined || typeof view.matchMedia !== 'function') return 'dark';
  try {
    return view.matchMedia(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

/**
 * Write the three attributes and `color-scheme` onto `<html>`. Idempotent; safe to call on every
 * settings change (the `storage` event from another tab included).
 */
export function applySettings(
  settings: StarlingSettings,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): void {
  const root = doc?.documentElement;
  if (root === undefined) return;

  const theme = resolveTheme(settings.theme, doc);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;

  if (settings.motion === 'system') {
    delete root.dataset.motion;
  } else {
    root.dataset.motion = settings.motion;
  }

  root.dataset.density = settings.density;
}
