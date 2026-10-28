import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import '../../lib/test-dom';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsDrawer, type SettingsDrawerProps } from './SettingsDrawer';
import { SETTINGS_STORAGE_KEY, type StarlingSettings } from './schema';
import { type MemoryStorage, memoryStorage, resetDocument } from './test-support';

let storage: MemoryStorage;

beforeEach(() => {
  storage = memoryStorage();
});

afterEach(() => {
  cleanup();
  resetDocument();
  localStorage.clear();
});

function stored(): StarlingSettings {
  return JSON.parse(storage.data[SETTINGS_STORAGE_KEY] ?? '{}') as StarlingSettings;
}

function setup(overrides: Partial<SettingsDrawerProps> = {}) {
  const changes: StarlingSettings[] = [];
  const closes: number[] = [];
  const view = render(
    <SettingsDrawer
      storage={storage}
      onClose={() => closes.push(1)}
      onSettingsChange={(next) => changes.push(next)}
      {...overrides}
    />,
  );
  return { ...view, changes, closes };
}

function dialog(): HTMLElement {
  return screen.getByRole('dialog');
}

describe('SettingsDrawer', () => {
  test('is a labelled modal dialog with all four groups', () => {
    setup();
    const panel = dialog();
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    for (const group of ['Appearance', 'Motion & sound', 'Demo', 'Connection']) {
      expect(screen.getByRole('region', { name: group })).toBeTruthy();
    }
  });

  test('focus moves into the drawer on open and returns to the trigger on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open settings';
    document.body.append(trigger);
    trigger.focus();

    const view = setup();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close settings' }));

    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  test('the close button calls onClose', () => {
    const { closes } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(closes).toHaveLength(1);
  });

  test('Esc calls onClose', () => {
    const { closes } = setup();
    fireEvent.keyDown(dialog(), { key: 'Escape' });
    expect(closes).toHaveLength(1);
  });

  test('Tab from the last control wraps to the first', () => {
    setup();
    const buttons = screen.getAllByRole('button');
    const first = buttons[0] as HTMLElement;
    const last = buttons[buttons.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  test('Shift+Tab from the first control wraps to the last', () => {
    setup();
    const buttons = screen.getAllByRole('button');
    const first = buttons[0] as HTMLElement;
    const last = buttons[buttons.length - 1] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test('a theme change applies data-theme immediately, persists it and notifies the shell', () => {
    const { changes } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(stored().theme).toBe('light');
    expect(storage.data['starling.theme']).toBe('light');
    expect(changes.at(-1)?.theme).toBe('light');
  });

  test('density and reduced motion write the attributes Epic 112 will style', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(document.documentElement.dataset.density).toBe('compact');
    expect(stored().density).toBe('compact');

    fireEvent.click(screen.getByRole('button', { name: 'Reduced' }));
    expect(document.documentElement.dataset.motion).toBe('reduced');
    fireEvent.click(within(screen.getByTestId('motion-options')).getByRole('button', { name: 'System' }));
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });

  test('the token is masked by default and can be revealed', () => {
    setup();
    const token = screen.getByLabelText('Access token') as HTMLInputElement;
    expect(token.type).toBe('password');
    const reveal = screen.getByRole('button', { name: 'Show access token' });
    expect(reveal.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(reveal);
    expect((screen.getByLabelText('Access token') as HTMLInputElement).type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide access token' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  test('typing a token persists it without logging it anywhere visible', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Access token'), { target: { value: 'ABCD-1234' } });
    expect(stored().token).toBe('ABCD-1234');
    expect(screen.queryByText('ABCD-1234')).toBeNull();
    expect(screen.getByText(/Stored only in this browser/)).toBeTruthy();
  });

  test('Clear empties the token', () => {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, token: 'ABCD-1234' }));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(stored().token).toBe('');
    expect((screen.getByLabelText('Access token') as HTMLInputElement).value).toBe('');
  });

  test('the sound switch persists to the Sky’s legacy key', () => {
    setup();
    const toggle = screen.getByRole('switch', { name: 'Soundscape' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(storage.data['starling.sky.sound']).toBe('on');
    expect(stored().sound).toBe(true);
  });

  test('demo speed changes are stored', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '4×' }));
    expect(stored().demoSpeed).toBe(4);
  });

  test('reset needs a confirmation, then restores every default', () => {
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        theme: 'light',
        motion: 'reduced',
        sound: true,
        demoSpeed: 16,
        density: 'compact',
        serverUrl: 'http://hub:7777',
        token: 'ABCD-1234',
      }),
    );
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    expect(screen.getByText('Reset every setting to its default?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(stored().theme).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, reset' }));
    expect(stored()).toMatchObject({
      theme: 'dark',
      motion: 'system',
      sound: false,
      demoSpeed: 1,
      density: 'comfortable',
      serverUrl: '',
      token: '',
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  test('Test probes the typed hub and reports success', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;
    setup({ fetchImpl });

    const url = screen.getByLabelText('Hub URL');
    fireEvent.change(url, { target: { value: 'http://localhost:7777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    const status = await screen.findByTestId('health-status');
    expect(status.dataset.ok).toBe('true');
    expect(status.textContent).toContain('Reachable');
    expect(calls).toEqual(['http://localhost:7777/api/health']);
    expect(stored().serverUrl).toBe('http://localhost:7777');
  });

  test('Test reports a failed hub without throwing', async () => {
    const fetchImpl = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    setup({ fetchImpl });

    fireEvent.change(screen.getByLabelText('Hub URL'), { target: { value: 'http://hub:7777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    const status = await screen.findByTestId('health-status');
    expect(status.dataset.ok).toBe('false');
    expect(status.textContent).toContain('Not reachable');
  });

  test('a hostile URL is refused before any request is made', () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return { ok: true, status: 200 } as Response;
    }) as typeof fetch;
    setup({ fetchImpl });

    const url = screen.getByLabelText('Hub URL');
    fireEvent.change(url, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    expect(screen.getByTestId('server-url-error')).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(stored().serverUrl ?? '').toBe('');
  });

  test('the URL commits on blur in canonical form', () => {
    setup();
    const url = screen.getByLabelText('Hub URL') as HTMLInputElement;
    fireEvent.change(url, { target: { value: 'HTTPS://Hub.Example:7777/' } });
    fireEvent.blur(url);
    expect(stored().serverUrl).toBe('https://hub.example:7777');
    expect(url.value).toBe('https://hub.example:7777');
  });

  test('an empty URL means same origin', () => {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, serverUrl: 'http://hub:7777' }));
    setup();
    const url = screen.getByLabelText('Hub URL') as HTMLInputElement;
    fireEvent.change(url, { target: { value: '' } });
    fireEvent.blur(url);
    expect(stored().serverUrl).toBe('');
    expect(screen.getByPlaceholderText('Same origin (default)')).toBeTruthy();
  });

  test('every extra prop is optional (the manifest cast stays honest)', () => {
    expect(() => {
      const view = render(<SettingsDrawer storage={storage} />);
      view.unmount();
    }).not.toThrow();
  });

  test('a settings change is announced once per accepted change', () => {
    const { changes } = setup();
    fireEvent.click(screen.getByRole('button', { name: '16×' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(changes).toHaveLength(2);
    expect(changes[0]?.demoSpeed).toBe(16);
    expect(changes[1]?.density).toBe('compact');
  });

  test('Tab trapping survives opening the reset confirmation', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes, reset' })).toBeTruthy());
    const buttons = screen.getAllByRole('button');
    const first = buttons[0] as HTMLElement;
    const last = buttons[buttons.length - 1] as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });
});
