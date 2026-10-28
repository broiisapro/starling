import type { ComponentType } from 'react';
import type { SkyState } from '../../data/reducer';
import { ToastHost } from './ToastHost';

/**
 * `features/toasts` — the dashboard's shoulder tap.
 *
 * Self-contained module for checkpoint C3: the manifest below is all the shell needs. It is an
 * `overlay` feature and must be mounted **always** (`{ mount: 'always' }`) so it can observe the
 * whole event stream; it renders nothing while the stack is empty.
 */
export const FEATURE = 'toasts' as const;

/**
 * The shape every Wave 3 feature consumes (ARCHITECTURE §8's `FeatureProps` with the Wave 3 state).
 * Declared locally because `apps/web/src/data` belongs to Wave 3b.
 */
export interface FeatureProps {
  state: SkyState;
  onSelectTask?(key: string): void;
  onSelectRun?(runId: string): void;
  onClose?(): void;
}

export const feature = {
  id: 'toasts',
  title: 'Notifications',
  description: 'Toast stack for landings, failed audits, flock changes, budget and the run summary',
  kind: 'overlay',
  icon: 'Bell',
  hotkey: undefined,
  Component: ToastHost as ComponentType<FeatureProps>,
} as const;

export type { Cursor, CursorStep } from './cursor';
export { cursorAt, EMPTY_CURSOR, newEventsSince } from './cursor';
export {
  BUDGET_WARN_RATIO,
  TOAST_BODY_MAX,
  type ToastContext,
  type ToastKind,
  type ToastSpec,
  toastId,
  toastsFromEvents,
} from './derive';
export {
  DESKTOP_KINDS,
  DESKTOP_STORAGE_KEY,
  desktopStorage,
  desktopSupported,
  documentVisibility,
  type NotificationCtorLike,
  type NotificationLike,
  type NotificationOptionsLike,
  notificationCtor,
  notifyDesktop,
  readDesktopOptIn,
  requestDesktopPermission,
  shouldNotifyKind,
  writeDesktopOptIn,
} from './desktop';
export {
  AUTO_DISMISS_MS,
  COLLAPSE_WINDOW_MS,
  createToastQueue,
  dismiss,
  emptyStack,
  enqueue,
  isSticky,
  MAX_VISIBLE,
  pauseAll,
  resumeAll,
  type ToastEntry,
  type ToastQueue,
  type ToastQueueOptions,
  type ToastStack,
  type ToastTimers,
  tick,
} from './queue';
export { ToastHost, type ToastHostProps } from './ToastHost';
