import { afterEach, describe, expect, test } from 'bun:test';
import { ensureDom } from './test-dom';
import { useMediaQuery, useWideFlock, WIDE_FLOCK_QUERY } from './viewport';

ensureDom();
const { cleanup, renderHook, act } = await import('@testing-library/react');

afterEach(cleanup);

/** A controllable `matchMedia` so the hook can be driven without resizing anything. */
function fakeMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  let matches = initial;
  const list = {
    get matches() {
      return matches;
    },
    media: WIDE_FLOCK_QUERY,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  };
  return {
    list,
    listeners,
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('useMediaQuery', () => {
  test('reads the current match and follows change events', () => {
    const original = window.matchMedia;
    const fake = fakeMatchMedia(false);
    window.matchMedia = (() => fake.list) as unknown as typeof window.matchMedia;
    try {
      const { result } = renderHook(() => useMediaQuery(WIDE_FLOCK_QUERY));
      expect(result.current).toBe(false);

      act(() => fake.set(true));
      expect(result.current).toBe(true);

      act(() => fake.set(false));
      expect(result.current).toBe(false);
      expect(fake.listeners.size).toBe(1);
    } finally {
      window.matchMedia = original;
    }
  });

  test('unsubscribes on unmount and falls back to the caller’s default', () => {
    const original = window.matchMedia;
    const fake = fakeMatchMedia(false);
    window.matchMedia = (() => fake.list) as unknown as typeof window.matchMedia;
    try {
      const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 1px)', true));
      expect(result.current).toBe(false);
      unmount();
      expect(fake.listeners.size).toBe(0);
    } finally {
      window.matchMedia = original;
    }
  });

  test('useWideFlock asks for a projector-sized screen', () => {
    // The query is part of the contract: cards need both width and height.
    expect(WIDE_FLOCK_QUERY).toContain('min-width');
    expect(WIDE_FLOCK_QUERY).toContain('min-height');
    const original = window.matchMedia;
    const fake = fakeMatchMedia(true);
    window.matchMedia = (() => fake.list) as unknown as typeof window.matchMedia;
    try {
      const { result } = renderHook(() => useWideFlock());
      expect(result.current).toBe(true);
    } finally {
      window.matchMedia = original;
    }
  });
});
