import type { ToastKind, ToastSpec } from './derive';

/**
 * Opt-in desktop notifications.
 *
 * The dashboard is often on a second screen while the user works elsewhere, so a toast that lands
 * while the tab is hidden is invisible. This module is the small, deliberate bridge: it never asks
 * for permission on load, never notifies while the tab is visible, and is a no-op when the browser
 * has no `Notification` API (happy-dom, a locked-down kiosk, an older browser).
 */
export const DESKTOP_STORAGE_KEY = 'starling.toasts.desktop.v1';

/** Only the moments that are worth interrupting another window for. */
export const DESKTOP_KINDS: readonly ToastKind[] = ['run-finished', 'audit-failed', 'node-left', 'budget'];

export interface NotificationLike {
  close?(): void;
}

export interface NotificationOptionsLike {
  body?: string;
  tag?: string;
}

export interface NotificationCtorLike {
  new (title: string, options?: NotificationOptionsLike): NotificationLike;
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission> | NotificationPermission;
}

export interface DesktopScope {
  Notification?: NotificationCtorLike;
}

export interface DesktopStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `localStorage` throws in some privacy modes; never let the dashboard crash over a preference. */
export function desktopStorage(): DesktopStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readDesktopOptIn(storage: DesktopStorage | undefined = desktopStorage()): boolean {
  try {
    return storage?.getItem(DESKTOP_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeDesktopOptIn(
  enabled: boolean,
  storage: DesktopStorage | undefined = desktopStorage(),
): void {
  try {
    storage?.setItem(DESKTOP_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // A blocked storage write only means the preference lasts for this tab. Not an error worth
    // surfacing: the bell still reflects the in-memory toggle.
  }
}

function defaultScope(): DesktopScope {
  return globalThis as unknown as DesktopScope;
}

export function notificationCtor(scope: DesktopScope = defaultScope()): NotificationCtorLike | undefined {
  return scope.Notification;
}

export function desktopSupported(scope: DesktopScope = defaultScope()): boolean {
  return notificationCtor(scope) !== undefined;
}

/**
 * Ask the browser for permission. Only call this from a click handler: a prompt on load is both
 * hostile and blocked by most browsers.
 */
export async function requestDesktopPermission(scope: DesktopScope = defaultScope()): Promise<boolean> {
  const ctor = notificationCtor(scope);
  if (ctor === undefined) return false;
  try {
    if (ctor.permission === 'granted') return true;
    if (ctor.permission === 'denied') return false;
    const result = await ctor.requestPermission();
    return result === 'granted';
  } catch {
    // Permission APIs can throw on insecure origins. Reporting "not granted" is the whole contract.
    return false;
  }
}

export function shouldNotifyKind(kind: ToastKind): boolean {
  return DESKTOP_KINDS.includes(kind);
}

export function documentVisibility(): DocumentVisibilityState {
  if (typeof document === 'undefined') return 'visible';
  return document.visibilityState;
}

export interface NotifyOptions {
  enabled: boolean;
  Notification?: NotificationCtorLike;
  /** Injectable so tests can simulate a hidden tab without a real browser. */
  visibility?: () => DocumentVisibilityState;
}

/**
 * Fire a desktop notification for a spec, or do nothing.
 *
 * Returns whether a notification was created, which makes the hidden-tab rule testable. `tag` is
 * the toast id, so the OS collapses repeats of the same event instead of stacking duplicates.
 */
export function notifyDesktop(spec: ToastSpec, options: NotifyOptions): boolean {
  if (!options.enabled || !shouldNotifyKind(spec.kind)) return false;
  const visibility = options.visibility ?? documentVisibility;
  if (visibility() !== 'hidden') return false;
  const ctor = options.Notification;
  if (ctor === undefined || ctor.permission !== 'granted') return false;
  try {
    new ctor(spec.title, {
      ...(spec.body === undefined ? {} : { body: spec.body }),
      tag: spec.id,
    });
    return true;
  } catch {
    // Some browsers throw on construction from a non-user gesture; the toast is still on screen.
    return false;
  }
}
