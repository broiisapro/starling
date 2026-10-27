import { afterEach, describe, expect, test } from 'bun:test';
import type { PublicConfig } from '../data/api';
import { ensureDom } from '../lib/test-dom';
import { TopBar } from './TopBar';

ensureDom();
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');

afterEach(cleanup);

const CONFIG: PublicConfig = {
  version: '1.2.3',
  profile: 'opencode',
  models: {
    planner: 'deepseek-v4.1-flash',
    worker: 'deepseek-v4.1-flash',
    resolver: 'deepseek-v4.1-flash',
    auditor: 'deepseek-v4.1-flash',
    summarizer: 'deepseek-v4.1-flash',
    writer: 'deepseek-v4.1-flash',
  },
  flockEnabled: true,
};

function renderBar(over: Partial<Parameters<typeof TopBar>[0]> = {}) {
  return render(
    <TopBar
      runs={[]}
      connection="live"
      speed={1}
      onSpeedChange={() => {}}
      theme="dark"
      onToggleTheme={() => {}}
      onSelectRun={() => {}}
      view="sky"
      onViewChange={() => {}}
      {...over}
    />,
  );
}

describe('TopBar live chrome', () => {
  test('shows the auditor model and every role from /api/config/public', () => {
    const { container } = renderBar({ config: CONFIG });
    expect(screen.getByText('auditor: deepseek-v4.1-flash (opencode)')).toBeDefined();
    const roles = container.querySelector('[data-testid="model-roles"]');
    expect(roles?.textContent).toContain('planner: deepseek-v4.1-flash (opencode)');
    expect(roles?.textContent?.split('\n')).toHaveLength(6);
  });

  test('hides the model line without a config and switches to demo in one click', () => {
    const calls: string[] = [];
    renderBar({ onToggleDemo: () => calls.push('demo') });
    expect(screen.queryByText(/auditor:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to demo replay' }));
    expect(calls).toEqual(['demo']);
  });

  test('in demo mode the same control returns to live', () => {
    const calls: string[] = [];
    renderBar({ connection: 'demo', onToggleDemo: () => calls.push('live') });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to live data' }));
    expect(calls).toEqual(['live']);
  });
});
