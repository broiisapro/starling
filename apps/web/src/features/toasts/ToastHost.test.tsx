import '../../lib/test-dom';
import { afterEach, describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core/browser';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';
import type { NotificationCtorLike, NotificationOptionsLike } from './desktop';
import { DESKTOP_STORAGE_KEY } from './desktop';
import { ToastHost } from './ToastHost';
import { auditEvent, finishedEvent, mergeEvent, planEvent } from './test-events';

const FIXTURE_BASELINE = 30;

function stateOf(events: readonly StarlingEvent[]): SkyState {
  return applyEvents(createInitialState(), events);
}

function toastKinds(container: ParentNode): string[] {
  return [...container.querySelectorAll('[data-toast-kind]')].map(
    (element) => element.getAttribute('data-toast-kind') ?? '',
  );
}

function byKind(container: ParentNode, kind: string): Element[] {
  return [...container.querySelectorAll(`[data-toast-kind="${kind}"]`)];
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  Reflect.deleteProperty(globalThis, 'Notification');
  Reflect.deleteProperty(document, 'visibilityState');
});

interface InstalledNotification {
  sent: { title: string; options?: NotificationOptionsLike }[];
  requested(): number;
  setPermission(permission: NotificationPermission): void;
}

/** A minimal stand-in for the browser API; `Notification` is absent in happy-dom. */
function installNotification(initial: NotificationPermission = 'granted'): InstalledNotification {
  const sent: { title: string; options?: NotificationOptionsLike }[] = [];
  let permission = initial;
  let requests = 0;

  class FakeNotification {
    static get permission(): NotificationPermission {
      return permission;
    }

    static requestPermission(): Promise<NotificationPermission> {
      requests += 1;
      permission = 'granted';
      return Promise.resolve<NotificationPermission>('granted');
    }

    constructor(title: string, options?: NotificationOptionsLike) {
      sent.push({ title, options });
    }
  }

  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value: FakeNotification as unknown as NotificationCtorLike,
  });

  return {
    sent,
    requested: () => requests,
    setPermission: (next) => {
      permission = next;
    },
  };
}

function hideTab(): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
}

describe('ToastHost: live region', () => {
  test('renders an empty polite status region before anything happens', () => {
    const { container } = render(<ToastHost state={createInitialState()} />);
    const region = container.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(toastKinds(container)).toEqual([]);
  });

  test('an error toast makes the region assertive', () => {
    const baseline = [planEvent()];
    const view = render(<ToastHost state={stateOf(baseline)} />);
    view.rerender(
      <ToastHost
        state={stateOf([
          ...baseline,
          {
            type: 'log',
            runId: 'run-1',
            ts: 1_731_000_001_000,
            payload: { level: 'error', msg: 'perch gone' },
          },
        ])}
      />,
    );
    expect(view.container.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('assertive');
    expect(byKind(view.container, 'error')).toHaveLength(1);
  });

  test('reduced motion is reflected as data-reduced-motion', () => {
    const { container } = render(<ToastHost state={createInitialState()} />);
    expect(container.querySelector('[data-testid="toast-host"]')?.getAttribute('data-reduced-motion')).toBe(
      'false',
    );
  });
});

describe('ToastHost: no history replay', () => {
  test('mounting on a finished run shows nothing', () => {
    const state = stateOf(demoEvents());
    const { container } = render(<ToastHost state={state} />);
    expect(toastKinds(container)).toEqual([]);
  });

  test('a run switch does not replay the new run history', () => {
    const first = [planEvent(), mergeEvent({ taskKey: 'a' })];
    const view = render(<ToastHost state={stateOf(first)} />);
    const otherRun: StarlingEvent[] = [
      { type: 'log', runId: 'run-2', ts: 1_731_000_010_000, payload: { level: 'info', msg: 'second run' } },
      {
        type: 'merge.result',
        runId: 'run-2',
        ts: 1_731_000_011_000,
        payload: {
          taskKey: 'b',
          status: 'merged',
          conflictedFiles: [],
          detail: 'merged',
          ts: 1_731_000_011_000,
        },
      },
    ];
    view.rerender(<ToastHost state={stateOf(otherRun)} />);
    expect(toastKinds(view.container)).toEqual([]);
  });
});

describe('ToastHost: actions', () => {
  test('Show selects the toast task', () => {
    const baseline = [planEvent()];
    const selected: string[] = [];
    const view = render(<ToastHost state={stateOf(baseline)} onSelectTask={(key) => selected.push(key)} />);
    view.rerender(
      <ToastHost
        state={stateOf([...baseline, auditEvent({ taskKey: 'theme', ts: 1_731_000_000_500 })])}
        onSelectTask={(key) => selected.push(key)}
      />,
    );

    const show = [...view.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Show',
    );
    expect(show).toBeDefined();
    fireEvent.click(show as Element);
    expect(selected).toEqual(['theme']);
  });

  test('the close button dismisses a toast and it does not come back', () => {
    const baseline = [planEvent()];
    const view = render(<ToastHost state={stateOf(baseline)} />);
    const event = mergeEvent({ taskKey: 'dates-fix' });
    view.rerender(<ToastHost state={stateOf([...baseline, event])} />);
    expect(byKind(view.container, 'merged')).toHaveLength(1);

    const close = view.container.querySelector('button[aria-label="Dismiss dates-fix landed"]');
    expect(close).not.toBeNull();
    fireEvent.click(close as Element);
    expect(byKind(view.container, 'merged')).toHaveLength(0);

    // A second render with the same events must not resurrect it.
    view.rerender(<ToastHost state={stateOf([...baseline, event])} />);
    expect(byKind(view.container, 'merged')).toHaveLength(0);
  });

  test('muted suppresses the stack, and unmuting does not replay the muted window', () => {
    const baseline = [planEvent()];
    const view = render(<ToastHost state={stateOf(baseline)} muted />);
    view.rerender(<ToastHost state={stateOf([...baseline, mergeEvent()])} muted />);
    expect(view.container.firstChild).toBeNull();

    view.rerender(<ToastHost state={stateOf([...baseline, mergeEvent()])} />);
    expect(view.container.querySelector('[data-testid="toast-host"]')).not.toBeNull();
    expect(toastKinds(view.container)).toEqual([]);
  });
});

describe('ToastHost: desktop notifications', () => {
  test('the bell asks for permission on click and stores the opt-in', async () => {
    const notifications = installNotification('default');
    const baseline = [planEvent()];
    const view = render(<ToastHost state={stateOf(baseline)} />);
    view.rerender(<ToastHost state={stateOf([...baseline, auditEvent()])} />);

    const bell = view.container.querySelector('button[aria-label="Enable desktop notifications"]');
    expect(bell).not.toBeNull();
    expect(notifications.requested()).toBe(0);

    await act(async () => {
      fireEvent.click(bell as Element);
      await Promise.resolve();
    });

    expect(notifications.requested()).toBe(1);
    expect(localStorage.getItem(DESKTOP_STORAGE_KEY)).toBe('on');
    expect(
      view.container
        .querySelector('button[aria-label="Disable desktop notifications"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  test('a hidden tab notifies for run-finished but not for a landing', () => {
    const notifications = installNotification('granted');
    hideTab();
    localStorage.setItem(DESKTOP_STORAGE_KEY, 'on');

    const baseline = [planEvent()];
    const view = render(<ToastHost state={stateOf(baseline)} />);
    const landing = mergeEvent({ taskKey: 'a', ts: 1_731_000_000_100 });
    view.rerender(<ToastHost state={stateOf([...baseline, landing])} />);
    expect(toastKinds(view.container)).toContain('merged');
    expect(notifications.sent).toEqual([]);

    view.rerender(
      <ToastHost
        state={stateOf([...baseline, landing, finishedEvent({}, 'All seven landed.', 1_731_000_000_200)])}
      />,
    );
    expect(notifications.sent.map((entry) => entry.title)).toEqual(['Run finished']);
  });

  test('a visible tab never notifies', () => {
    const notifications = installNotification('granted');
    localStorage.setItem(DESKTOP_STORAGE_KEY, 'on');

    const baseline = [planEvent()];
    const view = render(<ToastHost state={stateOf(baseline)} />);
    view.rerender(<ToastHost state={stateOf([...baseline, finishedEvent()])} />);

    expect(toastKinds(view.container)).toContain('run-finished');
    expect(notifications.sent).toEqual([]);
  });

  test('without a Notification API the bell is absent and nothing throws', () => {
    const baseline = [planEvent()];
    const view = render(<ToastHost state={stateOf(baseline)} />);
    view.rerender(<ToastHost state={stateOf([...baseline, auditEvent()])} />);
    expect(byKind(view.container, 'audit-failed')).toHaveLength(1);
    expect(view.container.querySelector('button[aria-label="Enable desktop notifications"]')).toBeNull();
  });
});

describe('ToastHost: the recorded run', () => {
  test('feeding the fixture after mount yields one failed audit, collapsed landings and one finish', () => {
    const events = demoEvents();
    const seen = new Map<string, { kind: string; title: string }>();
    const view = render(<ToastHost state={stateOf(events.slice(0, FIXTURE_BASELINE))} />);

    for (let index = FIXTURE_BASELINE + 1; index <= events.length; index += 1) {
      view.rerender(<ToastHost state={stateOf(events.slice(0, index))} />);
      for (const element of view.container.querySelectorAll('[data-toast-kind]')) {
        const id = element.getAttribute('data-toast-id');
        if (id === null) continue;
        seen.set(id, {
          kind: element.getAttribute('data-toast-kind') ?? '',
          title: element.querySelector('p')?.textContent ?? '',
        });
      }
    }

    const values = [...seen.values()];
    expect(values.filter((toast) => toast.kind === 'audit-failed')).toHaveLength(1);
    expect(values.some((toast) => toast.kind === 'merged' && /tasks landed/.test(toast.title))).toBe(true);
    expect(values.filter((toast) => toast.kind === 'run-finished')).toHaveLength(1);
    expect(values.some((toast) => toast.kind === 'node-joined')).toBe(true);
    expect(values.some((toast) => toast.kind === 'node-left')).toBe(true);
    expect(values.some((toast) => toast.kind === 'migrated')).toBe(true);
  });
});
