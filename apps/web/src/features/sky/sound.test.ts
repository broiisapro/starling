/**
 * Soundscape (Epic 47): the toggle's persistence must survive hostile storage, and the synth must be
 * inert (not throw) when WebAudio or the context is unavailable. No real audio device is touched.
 */
import { describe, expect, test } from 'bun:test';
import {
  createSkyAudio,
  readSoundEnabled,
  SOUND_STORAGE_KEY,
  type StorageLike,
  safeStorage,
  writeSoundEnabled,
} from './sound';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError: storage is blocked');
  },
  setItem: () => {
    throw new Error('SecurityError: storage is blocked');
  },
};

/** Minimal WebAudio stand-in: records oscillator creation so tests can prove a cue was synthesised. */
class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  cancelScheduledValues(): void {}
  exponentialRampToValueAtTime(): void {}
  setTargetAtTime(): void {}
}

class FakeOscillator {
  type = 'sine';
  frequency = new FakeParam();
  connect(): void {}
  start(): void {}
  stop(): void {}
}

class FakeGain {
  gain = new FakeParam();
  connect(): void {}
}

function fakeContext() {
  const state = { oscillators: 0, closed: false };
  const context = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createGain: () => new FakeGain(),
    createOscillator: () => {
      state.oscillators += 1;
      return new FakeOscillator();
    },
    resume: () => {},
    close: () => {
      state.closed = true;
    },
  };
  return { context, state };
}

describe('preference persistence', () => {
  test('is off by default and round-trips through storage', () => {
    const storage = memoryStorage();
    expect(readSoundEnabled(storage)).toBe(false);
    writeSoundEnabled(true, storage);
    expect(storage.data[SOUND_STORAGE_KEY]).toBe('on');
    expect(readSoundEnabled(storage)).toBe(true);
    writeSoundEnabled(false, storage);
    expect(readSoundEnabled(storage)).toBe(false);
    expect(readSoundEnabled(undefined)).toBe(false);
  });

  test('a corrupt value means off, not a crash', () => {
    expect(readSoundEnabled(memoryStorage({ [SOUND_STORAGE_KEY]: 'maybe' }))).toBe(false);
  });

  test('storage that throws never breaks the toggle', () => {
    expect(readSoundEnabled(throwingStorage)).toBe(false);
    expect(() => writeSoundEnabled(true, throwingStorage)).not.toThrow();
    expect(() => writeSoundEnabled(false, throwingStorage)).not.toThrow();
  });

  test('safeStorage survives a localStorage getter that throws', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: denied');
      },
    });
    try {
      expect(safeStorage()).toBeUndefined();
      expect(readSoundEnabled()).toBe(false);
      expect(() => writeSoundEnabled(true)).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});

describe('the synth', () => {
  test('starts the hum, chirps on landing and whooshes on migration', () => {
    const { context, state } = fakeContext();
    const audio = createSkyAudio({ createContext: () => context as unknown as AudioContext });
    expect(audio.enabled).toBe(false);
    expect(audio.setEnabled(true)).toBe(true);
    expect(audio.enabled).toBe(true);
    const afterHum = state.oscillators;
    expect(afterHum).toBeGreaterThanOrEqual(2); // two detuned hum oscillators

    audio.cue('landing');
    expect(state.oscillators).toBe(afterHum + 1);
    audio.cue('migration');
    expect(state.oscillators).toBe(afterHum + 2);
    audio.cue('leave'); // no sound for a leave
    expect(state.oscillators).toBe(afterHum + 2);

    audio.setHum(0.8);
    expect(audio.setEnabled(false)).toBe(false);
    expect(audio.enabled).toBe(false);
    audio.cue('landing'); // muted: no new oscillator
    expect(state.oscillators).toBe(afterHum + 2);

    audio.dispose();
    expect(state.closed).toBe(true);
    expect(audio.setEnabled(true)).toBe(false);
  });

  test('is inert when WebAudio is unavailable', () => {
    const audio = createSkyAudio({ createContext: () => null });
    expect(audio.setEnabled(true)).toBe(false);
    expect(audio.enabled).toBe(false);
    expect(() => {
      audio.cue('landing');
      audio.cue('migration');
      audio.setHum(1);
      audio.resume();
      audio.dispose();
    }).not.toThrow();
  });
});
