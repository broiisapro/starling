/**
 * Heartbeat pacing for the perch loop.
 *
 * Ten perches on one Wi-Fi all boot at once (a demo does exactly that) and a fixed 3 s period makes
 * them hit the hub in lockstep forever. A small symmetric jitter spreads the calls out without
 * changing the average period, and `random` is injectable so tests are exact instead of statistical.
 */

/** Default jitter: ±10% of `heartbeatMs`. */
export const PERCH_HEARTBEAT_JITTER = 0.1;

/** Clamp a caller-supplied jitter into `[0, 1]`. Negative/NaN/undefined means "no jitter". */
export function normalizeJitter(jitter: number | undefined): number {
  if (jitter === undefined || !Number.isFinite(jitter) || jitter <= 0) return 0;
  return Math.min(jitter, 1);
}

export interface HeartbeatDelayOptions {
  /** Nominal period. */
  heartbeatMs: number;
  /** Fraction of the period to spread around, default {@link PERCH_HEARTBEAT_JITTER}. */
  jitter?: number;
  /** Uniform source in `[0, 1)`. Default `Math.random`; injected by tests for determinism. */
  random?: () => number;
}

/**
 * The next heartbeat delay: `heartbeatMs × (1 ± jitter)`.
 *
 * `random() === 0` gives the low end, `random() === 1` the high end, `0.5` the nominal period. The
 * result is a whole number of milliseconds so timers do not carry fractional state.
 */
export function nextHeartbeatDelay(opts: HeartbeatDelayOptions): number {
  const base = Number.isFinite(opts.heartbeatMs) ? Math.max(0, opts.heartbeatMs) : 0;
  const jitter = normalizeJitter(opts.jitter ?? PERCH_HEARTBEAT_JITTER);
  if (base === 0 || jitter === 0) return Math.round(base);

  const raw = (opts.random ?? Math.random)();
  const sample = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 1) : 0.5;
  return Math.round(base * (1 + jitter * (2 * sample - 1)));
}
