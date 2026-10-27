import type { NodeInfo, Run } from '@starling/core/browser';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  Flag,
  GitMerge,
  type LucideIcon,
  MoveRight,
  ShieldAlert,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BadgeTone } from '../../components';
import type { SkyState } from '../../data/reducer';
import { activeRunOf } from '../../data/selectors';
import { cn } from '../../lib/cn';
import { usePrefersReducedMotion } from '../metrics';
import { type Cursor, newEventsSince } from './cursor';
import { type ToastKind, toastsFromEvents } from './derive';
import {
  desktopSupported,
  notificationCtor,
  notifyDesktop,
  readDesktopOptIn,
  requestDesktopPermission,
  writeDesktopOptIn,
} from './desktop';
import { createToastQueue, type ToastQueue, type ToastTimers } from './queue';

/**
 * The toast host: a calm, bottom-right notification stack.
 *
 * It is an `overlay` feature with `mount: 'always'` (registered by checkpoint C3): it renders nothing
 * until something happens, and it never reads the store — the shell passes `state`, exactly like the
 * other panels.
 *
 * Two rules keep it from becoming a nuisance:
 * - toasts are derived from events that arrived **after** the host first saw the state (`cursor.ts`),
 *   so a demo loop, a run switch or an SSE backlog never replays history;
 * - at most four are visible, landings collapse, and only errors and budget warnings are sticky.
 */
export interface ToastHostProps {
  state: SkyState;
  onSelectTask?(taskKey: string): void;
  onSelectRun?(runId: string): void;
  onClose?(): void;
  /** Per-run budget in USD. The shell passes the launch/config value once it knows it. */
  budgetUsd?: number;
  /** Injectable timers for tests; production uses the browser's. */
  timers?: ToastTimers;
  /** Suppress every toast (and every desktop notification). */
  muted?: boolean;
  /** Injectable clock for tests; production uses `Date.now`. */
  now?(): number;
}

const ICONS: Record<ToastKind, LucideIcon> = {
  merged: CheckCircle2,
  'audit-failed': ShieldAlert,
  conflict: GitMerge,
  'node-joined': Wifi,
  'node-left': WifiOff,
  migrated: MoveRight,
  budget: Wallet,
  'run-finished': Flag,
  error: AlertTriangle,
};

const ICON_TONE: Record<BadgeTone, string> = {
  neutral: 'text-ink-3',
  accent: 'text-teal-300',
  success: 'text-emerald-300',
  warn: 'text-amber-300',
  danger: 'text-red-300',
  info: 'text-sky-300',
  violet: 'text-violet-300',
};

/** Literal class strings so Tailwind's scanner emits every tone. */
const EDGE_TONE: Record<BadgeTone, string> = {
  neutral: 'border-l-ink-4/60',
  accent: 'border-l-teal-400/70',
  success: 'border-l-emerald-400/70',
  warn: 'border-l-amber-400/70',
  danger: 'border-l-red-400/70',
  info: 'border-l-sky-400/70',
  violet: 'border-l-violet-400/70',
};

function ToastCard({
  entry,
  reducedMotion,
  onSelectTask,
  onDismiss,
}: {
  entry: {
    spec: { id: string; kind: ToastKind; tone: BadgeTone; title: string; body?: string; taskKey?: string };
    title: string;
    count: number;
  };
  reducedMotion: boolean;
  onSelectTask?: (taskKey: string) => void;
  onDismiss(id: string): void;
}) {
  const Icon = ICONS[entry.spec.kind];
  const taskKey = entry.spec.taskKey;
  return (
    <li
      data-toast-id={entry.spec.id}
      data-toast-kind={entry.spec.kind}
      className={cn(
        'pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-panel)] border border-hairline border-l-2 bg-panel-strong/95 p-3 shadow-[var(--shadow-panel)] backdrop-blur-md',
        EDGE_TONE[entry.spec.tone],
        reducedMotion
          ? 'transition-none'
          : 'transition-[opacity,transform] duration-200 ease-[var(--ease-flock)]',
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', ICON_TONE[entry.spec.tone])} />
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-ink-1">{entry.title}</p>
        {entry.spec.body !== undefined && entry.spec.body !== '' ? (
          <p className="mt-0.5 line-clamp-3 text-caption text-ink-3">{entry.spec.body}</p>
        ) : null}
        {entry.count > 1 ? (
          <p className="mt-0.5 text-micro uppercase tracking-wide text-ink-4">{entry.count} in this batch</p>
        ) : null}
        {taskKey !== undefined && onSelectTask !== undefined ? (
          <button
            type="button"
            onClick={() => onSelectTask(taskKey)}
            className="mt-1.5 rounded-[var(--radius-pill)] border border-hairline-strong px-2 py-0.5 text-micro font-medium text-ink-2 hover:border-irid-teal/60 hover:text-ink-1"
          >
            Show
          </button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`Dismiss ${entry.title}`}
        title="Dismiss"
        onClick={() => onDismiss(entry.spec.id)}
        className="shrink-0 rounded p-0.5 text-ink-4 hover:bg-surface-3/60 hover:text-ink-2"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </li>
  );
}

export function ToastHost({ state, onSelectTask, budgetUsd, timers, muted = false, now }: ToastHostProps) {
  const reducedMotion = usePrefersReducedMotion();
  const queue = useMemo<ToastQueue>(
    () =>
      createToastQueue({
        ...(timers === undefined ? {} : { timers }),
        ...(now === undefined ? {} : { now }),
      }),
    [timers, now],
  );

  useEffect(() => () => queue.dispose(), [queue]);

  const stack = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const cursor = useRef<Cursor | undefined>(undefined);

  // The bell is read lazily: `Notification` is missing on happy-dom and in some kiosk browsers.
  const [desktopOn, setDesktopOn] = useState<boolean>(() => readDesktopOptIn());
  const supported = desktopSupported();

  const events = state.events;
  const nodes: Record<string, NodeInfo> = state.nodes;
  const run: Run | undefined = activeRunOf(state);

  useEffect(() => {
    const step = newEventsSince(cursor.current, events);
    cursor.current = step.cursor;
    if (muted || step.fresh.length === 0) return;

    const specs = toastsFromEvents(step.fresh, {
      nodes,
      ...(run === undefined ? {} : { run }),
      ...(budgetUsd === undefined ? {} : { budgetUsd }),
    });
    for (const spec of specs) queue.push(spec);

    const enabled = readDesktopOptIn() && desktopOn;
    if (!enabled) return;
    const Notification = notificationCtor();
    for (const spec of specs) {
      notifyDesktop(spec, { enabled, ...(Notification === undefined ? {} : { Notification }) });
    }
  }, [events, nodes, run, budgetUsd, muted, desktopOn, queue]);

  // `onClose` is part of the overlay feature contract; the stack has no single "close everything"
  // affordance, so it is accepted in the props type but never read.

  const pause = useCallback(() => queue.pauseAll(), [queue]);
  const resume = useCallback(() => queue.resumeAll(), [queue]);
  const dismissOne = useCallback((id: string) => queue.dismiss(id), [queue]);

  // Muting clears what is on screen; the cursor keeps advancing in the event effect above, so
  // unmuting starts from silence rather than replaying the muted window.
  useEffect(() => {
    if (muted) queue.clear();
  }, [muted, queue]);

  const toggleDesktop = useCallback(async () => {
    if (desktopOn) {
      writeDesktopOptIn(false);
      setDesktopOn(false);
      return;
    }
    const granted = await requestDesktopPermission();
    if (!granted) return;
    writeDesktopOptIn(true);
    setDesktopOn(true);
  }, [desktopOn]);

  if (muted) return null;

  const hasError = stack.entries.some((entry) => entry.spec.kind === 'error');

  return (
    <section
      aria-label="Toasts"
      data-testid="toast-host"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      className="pointer-events-none fixed right-3 bottom-16 z-40 flex w-[min(92vw,21rem)] flex-col items-end gap-1.5"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocusCapture={pause}
      onBlurCapture={(event) => {
        // Moving focus between two buttons inside the stack must not restart the counters.
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        resume();
      }}
    >
      {stack.entries.length > 0 && supported ? (
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-hairline bg-panel/90 px-2 py-0.5 backdrop-blur-md">
          <span className="text-micro uppercase tracking-[0.14em] text-ink-4">Notifications</span>
          <button
            type="button"
            aria-pressed={desktopOn}
            aria-label={desktopOn ? 'Disable desktop notifications' : 'Enable desktop notifications'}
            title={
              desktopOn
                ? 'Desktop notifications on (hidden tab only)'
                : 'Also notify me when this tab is hidden'
            }
            onClick={() => void toggleDesktop()}
            className={cn(
              'rounded p-1 hover:bg-surface-3/70',
              desktopOn ? 'text-irid-teal' : 'text-ink-4 hover:text-ink-2',
            )}
          >
            {desktopOn ? (
              <BellRing aria-hidden="true" className="size-3.5" />
            ) : (
              <Bell aria-hidden="true" className="size-3.5" />
            )}
          </button>
        </div>
      ) : null}

      <div
        role="status"
        aria-live={hasError ? 'assertive' : 'polite'}
        aria-atomic="false"
        aria-label="Notifications"
        className="w-full"
      >
        <ol className="flex flex-col gap-1.5">
          {stack.entries.map((entry) => (
            <ToastCard
              key={entry.spec.id}
              entry={entry}
              reducedMotion={reducedMotion}
              onSelectTask={onSelectTask}
              onDismiss={dismissOne}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}
