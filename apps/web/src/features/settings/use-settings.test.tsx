import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import '../../lib/test-dom';
import { act, renderHook } from '@testing-library/react';
import { SETTINGS_STORAGE_KEY } from './schema';
import { type MemoryStorage, memoryStorage, resetDocument } from './test-support';
import { useSettings } from './use-settings';

let storage: MemoryStorage;

beforeEach(() => {
  storage = memoryStorage();
});

afterEach(() => {
  resetDocument();
});

describe('useSettings', () => {
  test('starts from storage and applies the document attributes', () => {
    storage.setItem('starling.theme', 'light');
    const { result } = renderHook(() => useSettings({ storage }));
    expect(result.current[0].theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  test('update merges, persists and returns the normalised next value', () => {
    const { result } = renderHook(() => useSettings({ storage }));
    let next = result.current[0];
    act(() => {
      next = result.current[1]({ theme: 'light', demoSpeed: 4 });
    });
    expect(next.theme).toBe('light');
    expect(next.demoSpeed).toBe(4);
    expect(result.current[0].demoSpeed).toBe(4);
    expect(JSON.parse(storage.data[SETTINGS_STORAGE_KEY] ?? '{}').demoSpeed).toBe(4);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  test('update guards invalid patches', () => {
    const { result } = renderHook(() => useSettings({ storage }));
    act(() => {
      result.current[1]({ theme: 'neon' as never, sound: 'yes' as never });
    });
    expect(result.current[0].theme).toBe('dark');
    expect(result.current[0].sound).toBe(false);
  });

  test('a storage event from another tab re-reads the blob', () => {
    const { result } = renderHook(() => useSettings({ storage }));
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: 1, theme: 'light', density: 'compact', demoSpeed: 16 }),
    );
    act(() => {
      const event = new Event('storage') as StorageEvent;
      Object.defineProperty(event, 'key', { value: SETTINGS_STORAGE_KEY });
      window.dispatchEvent(event);
    });
    expect(result.current[0].theme).toBe('light');
    expect(result.current[0].density).toBe('compact');
    expect(result.current[0].demoSpeed).toBe(16);
  });

  test('a storage event for an unrelated key is ignored', () => {
    const { result } = renderHook(() => useSettings({ storage }));
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, theme: 'light' }));
    act(() => {
      const event = new Event('storage') as StorageEvent;
      Object.defineProperty(event, 'key', { value: 'something.else' });
      window.dispatchEvent(event);
    });
    expect(result.current[0].theme).toBe('dark');
  });

  test('apply:false leaves <html> untouched', () => {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ version: 1, theme: 'light' }));
    renderHook(() => useSettings({ storage, apply: false }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.density).toBeUndefined();
  });
});
