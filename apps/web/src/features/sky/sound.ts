/**
 * The Sky's optional soundscape (Epic 47). Everything is synthesised with WebAudio — no audio files,
 * no network, nothing to ship — and it is **off by default**:
 *
 * - a short chirp when a flock lands on the wire (`merged`),
 * - a soft whoosh when a flock migrates between roosts,
 * - a low hum whose level tracks how many agents are working.
 *
 * The toggle is remembered per viewer in `localStorage`, wrapped in try/catch: Safari in private
 * mode, a locked-down iframe or a denied cookie jar all throw on access, and the dashboard must not
 * care. All the persistence helpers are pure and take a `StorageLike`, which is what the tests drive.
 */

export const SOUND_STORAGE_KEY = 'starling.sky.sound';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `localStorage` if the environment allows it, otherwise `undefined`. Never throws. */
export function safeStorage(): StorageLike | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    // Touching the getter is what throws in locked-down contexts, not the reference itself.
    const probe = '__starling_probe__';
    localStorage.getItem(probe);
    return localStorage;
  } catch {
    return undefined;
  }
}

/** Off unless the viewer explicitly turned it on. A corrupt value is off, not a crash. */
export function readSoundEnabled(storage: StorageLike | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(SOUND_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Persist the toggle. Failing to persist must never break the toggle itself. */
export function writeSoundEnabled(enabled: boolean, storage: StorageLike | undefined = safeStorage()): void {
  try {
    storage?.setItem(SOUND_STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // The sound keeps working for this page view; the preference just isn't remembered.
  }
}

export type AudioCue = 'landing' | 'migration' | 'join' | 'leave';

export interface SkyAudio {
  /** True when the context exists and the master gain is up. */
  readonly enabled: boolean;
  /** Returns the state actually reached (`false` when WebAudio is unavailable). */
  setEnabled(on: boolean): boolean;
  cue(kind: AudioCue, times?: number): void;
  /** 0..1 — the fraction of the flock that is working; drives the hum. */
  setHum(level: number): void;
  /** Browsers suspend a context created without a gesture; call this from the toggle's click. */
  resume(): void;
  dispose(): void;
}

export interface SkyAudioOptions {
  /** Injected for tests, or to share one context with the rest of the dashboard. */
  createContext?: () => AudioContext | null;
}

type AudioContextCtor = new () => AudioContext;

function defaultCreateContext(): AudioContext | null {
  try {
    const ctor: AudioContextCtor | undefined =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (globalThis as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!ctor) return null;
    return new ctor();
  } catch {
    return null;
  }
}

const MASTER_LEVEL = 0.26;
const HUM_LEVEL = 0.05;
const CHIRP_MIN_GAP_MS = 90;

/** An inert implementation: the same surface, no audio. Used when WebAudio is unavailable. */
function silentAudio(): SkyAudio {
  return {
    enabled: false,
    setEnabled: () => false,
    cue: () => {},
    setHum: () => {},
    resume: () => {},
    dispose: () => {},
  };
}

export function createSkyAudio(options: SkyAudioOptions = {}): SkyAudio {
  const make = options.createContext ?? defaultCreateContext;

  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let humGain: GainNode | null = null;
  let humOscillators: OscillatorNode[] = [];
  let enabled = false;
  let disposed = false;
  let lastChirpAt = 0;
  let humLevel = 0;

  function ensure(): boolean {
    if (disposed) return false;
    if (context && master) return true;
    const next = make();
    if (!next) return false;
    context = next;
    master = next.createGain();
    master.gain.value = 0;
    master.connect(next.destination);
    return true;
  }

  function setHumTarget(level: number): void {
    if (!context || !humGain) return;
    const target = Math.max(0, Math.min(1, level)) * HUM_LEVEL;
    const now = context.currentTime;
    try {
      humGain.gain.cancelScheduledValues(now);
      humGain.gain.setTargetAtTime(target, now, 0.35);
    } catch {
      humGain.gain.value = target;
    }
  }

  function startHum(): void {
    if (!context || !master || humGain) return;
    const ctx = context;
    const bus = master;
    humGain = ctx.createGain();
    humGain.gain.value = 0;
    humGain.connect(bus);
    // A fifth (54 Hz + 81 Hz) at a very low level: felt more than heard under the chirps.
    humOscillators = [54, 81].map((frequency) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      osc.connect(humGain as GainNode);
      osc.start();
      return osc;
    });
    setHumTarget(humLevel);
  }

  function envelope(ctx: AudioContext, node: GainNode, peak: number, attack: number, release: number): void {
    const now = ctx.currentTime;
    try {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(0.0001, now);
      node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
      node.gain.exponentialRampToValueAtTime(0.0001, now + attack + release);
    } catch {
      node.gain.value = 0;
    }
  }

  function chirp(ctx: AudioContext, bus: GainNode, index: number): void {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const start = 1480 + index * 260;
    osc.frequency.setValueAtTime(start, now);
    try {
      osc.frequency.exponentialRampToValueAtTime(start * 1.7, now + 0.09);
    } catch {
      // Frequency ramp unsupported: the chirp still plays at its base pitch.
    }
    osc.connect(gain);
    gain.connect(bus);
    envelope(ctx, gain, 0.16, 0.012, 0.1);
    osc.start(now + index * 0.035);
    osc.stop(now + 0.2 + index * 0.035);
  }

  function whoosh(ctx: AudioContext, bus: GainNode): void {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    try {
      osc.frequency.exponentialRampToValueAtTime(96, now + 0.55);
    } catch {
      // Keep the sweep's start pitch if ramps are unavailable.
    }
    osc.connect(gain);
    gain.connect(bus);
    envelope(ctx, gain, 0.12, 0.05, 0.5);
    osc.start(now);
    osc.stop(now + 0.62);
  }

  return {
    get enabled(): boolean {
      return enabled;
    },

    setEnabled(on: boolean): boolean {
      if (disposed) return false;
      if (!on) {
        enabled = false;
        if (master && context) {
          try {
            master.gain.setTargetAtTime(0, context.currentTime, 0.05);
          } catch {
            master.gain.value = 0;
          }
        }
        return false;
      }
      if (!ensure() || !context || !master) return false;
      enabled = true;
      startHum();
      try {
        master.gain.setTargetAtTime(MASTER_LEVEL, context.currentTime, 0.08);
      } catch {
        master.gain.value = MASTER_LEVEL;
      }
      return true;
    },

    cue(kind: AudioCue, times = 1): void {
      if (!enabled || !context || !master) return;
      const ctx = context;
      const bus = master;
      if (kind === 'migration' || kind === 'join') {
        whoosh(ctx, bus);
        return;
      }
      if (kind === 'leave') return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - lastChirpAt < CHIRP_MIN_GAP_MS) return;
      lastChirpAt = now;
      const count = Math.max(1, Math.min(3, Math.round(times)));
      for (let i = 0; i < count; i++) chirp(ctx, bus, i);
    },

    setHum(level: number): void {
      humLevel = Math.max(0, Math.min(1, level));
      if (enabled) setHumTarget(humLevel);
    },

    resume(): void {
      if (!context) return;
      try {
        if (context.state === 'suspended') void context.resume();
      } catch {
        // A blocked context simply stays silent.
      }
    },

    dispose(): void {
      disposed = true;
      enabled = false;
      for (const osc of humOscillators) {
        try {
          osc.stop();
        } catch {
          // Already stopped.
        }
      }
      humOscillators = [];
      try {
        void context?.close();
      } catch {
        // Nothing to close.
      }
      context = null;
      master = null;
      humGain = null;
    },
  };
}

/** A no-op audio engine for tests / SSR. */
export { silentAudio };
