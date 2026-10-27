import { afterEach, describe, expect, test } from 'bun:test';
import { useState } from 'react';
import { STATUS_COLORS, TASK_STATUSES } from '../lib/status';
import { ensureDom } from '../lib/test-dom';
import { Badge, EmptyState, ErrorBoundary, Kbd, Panel, Stat, StatusDot, Tabs, Tooltip } from './index';

ensureDom();
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');

afterEach(cleanup);

describe('design-system primitives', () => {
  test('StatusDot labels every task status for screen readers', () => {
    for (const status of TASK_STATUSES) {
      const { unmount } = render(<StatusDot status={status} />);
      const dot = screen.getByRole('img', { name: new RegExp(STATUS_COLORS[status].label) });
      expect(dot).toBeDefined();
      const painted = dot.querySelector('span:last-child') as HTMLElement | null;
      expect(painted?.style.backgroundColor).not.toBe('');
      unmount();
    }
  });

  test('StatusDot can show its label inline', () => {
    render(<StatusDot status="auditing" withLabel />);
    expect(screen.getByText('Auditing')).toBeDefined();
  });

  test('Badge renders text, tone class and title', () => {
    render(
      <Badge tone="success" title="all good">
        landed
      </Badge>,
    );
    const badge = screen.getByTitle('all good');
    expect(badge.textContent).toBe('landed');
    expect(badge.className).toContain('emerald');
  });

  test('Kbd renders a real kbd element', () => {
    render(<Kbd>?</Kbd>);
    const key = screen.getByText('?');
    expect(key.tagName).toBe('KBD');
  });

  test('Panel exposes a labelled section', () => {
    render(
      <Panel title="Flock" subtitle="two roosts">
        <p>body</p>
      </Panel>,
    );
    expect(screen.getByRole('heading', { name: 'Flock' })).toBeDefined();
    expect(screen.getByText('two roosts')).toBeDefined();
    expect(screen.getByText('body')).toBeDefined();
  });

  test('EmptyState shows title, description and action', () => {
    render(
      <EmptyState
        title="No birds yet"
        description="Start a run to fill the sky."
        action={<button type="button">Launch</button>}
      />,
    );
    expect(screen.getByText('No birds yet')).toBeDefined();
    expect(screen.getByText('Start a run to fill the sky.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Launch' })).toBeDefined();
  });

  test('Stat shows label, value and hint', () => {
    render(<Stat label="API spend" value="$0.031" hint="local saved $0.014" tone="warn" />);
    expect(screen.getByText('API spend')).toBeDefined();
    expect(screen.getByText('$0.031')).toBeDefined();
    expect(screen.getByText('local saved $0.014')).toBeDefined();
  });
});

function TabHarness() {
  const [value, setValue] = useState<'sky' | 'dag'>('sky');
  return (
    <Tabs<'sky' | 'dag'>
      ariaLabel="Sky views"
      value={value}
      onChange={setValue}
      tabs={[
        { id: 'sky', label: 'Sky' },
        { id: 'dag', label: 'Flight plan' },
      ]}
    />
  );
}

describe('Tabs', () => {
  test('selects on click and exposes aria-selected', () => {
    render(<TabHarness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabs[1] as HTMLElement);
    expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true');
  });

  test('moves selection with the arrow, Home and End keys', () => {
    render(<TabHarness />);
    const tablist = screen.getByRole('tablist', { name: 'Sky views' });
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist, { key: 'End' });
    expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true');
  });

  test('skips disabled tabs', () => {
    const seen: string[] = [];
    render(
      <Tabs
        ariaLabel="Skips"
        value="a"
        onChange={(value) => seen.push(value)}
        tabs={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B', disabled: true },
          { id: 'c', label: 'C' },
        ]}
      />,
    );
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(seen).toEqual([]);
  });
});

describe('Tooltip', () => {
  test('appears on focus and hides on blur', () => {
    render(
      <Tooltip content="Land it on the wire">
        <button type="button">go</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByRole('tooltip').textContent).toBe('Land it on the wire');
    fireEvent.blur(screen.getByRole('button', { name: 'go' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('wing fell off');
  return <p>flying</p>;
}

describe('ErrorBoundary', () => {
  test('renders children when nothing throws', () => {
    render(
      <ErrorBoundary name="sky">
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('flying')).toBeDefined();
  });

  test('catches a crash and renders the custom fallback', () => {
    // React logs the caught error; keep the test output readable.
    const original = console.error;
    console.error = () => {};
    try {
      render(
        <ErrorBoundary name="sky" fallback={(error) => <p>turbulence: {error.message}</p>}>
          <Boom explode />
        </ErrorBoundary>,
      );
    } finally {
      console.error = original;
    }
    expect(screen.getByText('turbulence: wing fell off')).toBeDefined();
  });

  test('defaults to an alert when no fallback is given', () => {
    const original = console.error;
    console.error = () => {};
    try {
      render(
        <ErrorBoundary name="queue">
          <Boom explode />
        </ErrorBoundary>,
      );
    } finally {
      console.error = original;
    }
    expect(screen.getByRole('alert').textContent).toContain('queue panel hit turbulence');
  });
});
