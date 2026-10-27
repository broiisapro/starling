import { describe, expect, test } from 'bun:test';
import {
  browserStorage,
  hasSeenTour,
  readTourSeen,
  recordTourSeen,
  shouldAutoStartTour,
  TOUR_STORAGE_KEY,
  type TourStorage,
} from './storage';

interface MemoryStorage extends TourStorage {
  readonly map: Map<string, string>;
}

function memoryStorage(initial?: string): MemoryStorage {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(TOUR_STORAGE_KEY, initial);
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function throwingStorage(): TourStorage {
  return {
    getItem: () => {
      throw new Error('storage disabled');
    },
    setItem: () => {
      throw new Error('storage disabled');
    },
  };
}

describe('shouldAutoStartTour', () => {
  test('?tour=1 opens the tour on a first visit', () => {
    expect(shouldAutoStartTour('?tour=1', memoryStorage())).toBe(true);
  });

  test('?tour=1 still wins after the tour has been seen', () => {
    const storage = memoryStorage(JSON.stringify({ seen: true, at: 1 }));
    expect(shouldAutoStartTour('?tour=1', storage)).toBe(true);
  });

  test('demo mode auto-starts on the first visit', () => {
    expect(shouldAutoStartTour('?demo=1', memoryStorage())).toBe(true);
  });

  test('demo mode stays quiet once the tour has been seen', () => {
    const storage = memoryStorage();
    recordTourSeen(storage, 1_700_000_000_000);
    expect(shouldAutoStartTour('?demo=1', storage)).toBe(false);
  });

  test('neither demo nor tour means no auto-start', () => {
    expect(shouldAutoStartTour('', memoryStorage())).toBe(false);
    expect(shouldAutoStartTour('?demo=0&speed=4', memoryStorage())).toBe(false);
    expect(shouldAutoStartTour('?run=abc', memoryStorage())).toBe(false);
  });

  test('?tour=0 is an explicit veto even for a first demo visit', () => {
    expect(shouldAutoStartTour('?demo=1&tour=0', memoryStorage())).toBe(false);
  });

  test('a corrupt record counts as never seen', () => {
    const storage = memoryStorage('{not json');
    expect(readTourSeen(storage)).toBeUndefined();
    expect(shouldAutoStartTour('?demo=1', storage)).toBe(true);
  });

  test('a disabled or throwing storage degrades to a first visit, never a throw', () => {
    expect(() => shouldAutoStartTour('?demo=1', throwingStorage())).not.toThrow();
    expect(shouldAutoStartTour('?demo=1', throwingStorage())).toBe(true);
  });
});

describe('recordTourSeen', () => {
  test('writes the documented shape with the supplied clock', () => {
    const storage = memoryStorage();
    expect(recordTourSeen(storage, 1_700_000_000_123)).toBe(true);
    expect(storage.map.get(TOUR_STORAGE_KEY)).toBe('{"seen":true,"at":1700000000123}');
    expect(readTourSeen(storage)).toEqual({ seen: true, at: 1_700_000_000_123 });
    expect(hasSeenTour(storage)).toBe(true);
  });

  test('overwrites an older record instead of appending', () => {
    const storage = memoryStorage(JSON.stringify({ seen: true, at: 1 }));
    recordTourSeen(storage, 99);
    expect(readTourSeen(storage)?.at).toBe(99);
  });

  test('reports failure when storage is unavailable', () => {
    expect(recordTourSeen(null, 5)).toBe(false);
    expect(readTourSeen(null)).toBeUndefined();
    expect(recordTourSeen(throwingStorage(), 5)).toBe(false);
  });

  test('the real localStorage works when the DOM provides one', () => {
    const storage = browserStorage();
    if (storage === undefined) return; // a bare Bun process has no localStorage; the guard is the point
    storage.setItem(TOUR_STORAGE_KEY, JSON.stringify({ seen: true, at: 7 }));
    expect(readTourSeen()?.at).toBe(7);
    storage.setItem(TOUR_STORAGE_KEY, '');
    expect(readTourSeen()).toBeUndefined();
  });
});
