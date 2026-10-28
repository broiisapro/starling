import { afterEach, describe, expect, test } from 'bun:test';
import '../../lib/test-dom';
import { applySettings, resolveTheme } from './apply';
import { DEFAULT_SETTINGS, type StarlingSettings } from './schema';
import { resetDocument } from './test-support';

afterEach(resetDocument);

const SETTINGS: StarlingSettings = {
  ...DEFAULT_SETTINGS,
  theme: 'light',
  motion: 'reduced',
  density: 'compact',
};

function fakeDocument(matches: boolean | undefined): Document {
  const defaultView = matches === undefined ? null : { matchMedia: () => ({ matches }) };
  return { documentElement: document.documentElement, defaultView } as unknown as Document;
}

describe('applySettings', () => {
  test('concrete themes set data-theme and color-scheme', () => {
    applySettings(SETTINGS);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');

    applySettings({ ...SETTINGS, theme: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  test('system resolves through prefers-color-scheme', () => {
    expect(resolveTheme('system', fakeDocument(true))).toBe('dark');
    expect(resolveTheme('system', fakeDocument(false))).toBe('light');
    applySettings({ ...SETTINGS, theme: 'system' }, fakeDocument(false));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  test('system without a media-query API stays dark', () => {
    expect(resolveTheme('system', fakeDocument(undefined))).toBe('dark');
    expect(resolveTheme('dark', fakeDocument(false))).toBe('dark');
    expect(resolveTheme('light', fakeDocument(true))).toBe('light');
  });

  test('motion is an attribute for reduced/full and absent for system', () => {
    applySettings({ ...SETTINGS, motion: 'reduced' });
    expect(document.documentElement.dataset.motion).toBe('reduced');
    applySettings({ ...SETTINGS, motion: 'full' });
    expect(document.documentElement.dataset.motion).toBe('full');
    applySettings({ ...SETTINGS, motion: 'system' });
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });

  test('density always lands on <html>', () => {
    applySettings({ ...SETTINGS, density: 'compact' });
    expect(document.documentElement.dataset.density).toBe('compact');
    applySettings({ ...SETTINGS, density: 'comfortable' });
    expect(document.documentElement.dataset.density).toBe('comfortable');
  });

  test('does nothing, and never throws, without a document', () => {
    expect(() => applySettings(SETTINGS, undefined)).not.toThrow();
    expect(() => resolveTheme('system', undefined)).not.toThrow();
  });
});
