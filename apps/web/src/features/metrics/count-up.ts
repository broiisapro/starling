import { useEffect, useRef, useState } from 'react';

/**
 * Count-up maths for the cost meter.
 *
 * Every number is a pure function of (from, to, elapsed). The hook only schedules frames, which
 * keeps the easing testable in happy-dom and lets the panel snap instantly when motion is off.
 */
export const COUNT_UP_MS = 550;

/** Fast start, gentle landing: the eye reads the last three digits, so they get the most time. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

export function interpolate(from: number, to: number, progress: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return to;
  return from + (to - from) * Math.min(1, Math.max(0, progress));
}

/** The displayed value `elapsedMs` into a count-up from `from` to `to`. */
export function countUpValue(from: number, to: number, elapsedMs: number, durationMs = COUNT_UP_MS): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return to;
  if (elapsedMs <= 0) return from;
  return interpolate(from, to, easeOutCubic(elapsedMs / durationMs));
}

/**
 * Animate a number towards `target` when `animate` is true; otherwise return it immediately.
 *
 * The previous *displayed* value is the starting point (tracked in a ref), so a second `metrics`
 * event that arrives mid-count-up continues from what the viewer can see instead of jumping back to
 * the last frame's target. Reduced motion and test renders pass `animate: false` and get the exact
 * number on the first paint — animation is never allowed to change the value, only its path.
 */
export function useCountUp(target: number, animate: boolean, durationMs = COUNT_UP_MS): number {
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [value, setValue] = useState(safeTarget);
  const displayed = useRef(safeTarget);

  useEffect(() => {
    if (!animate || durationMs <= 0 || typeof requestAnimationFrame !== 'function') {
      displayed.current = safeTarget;
      setValue(safeTarget);
      return;
    }
    if (displayed.current === safeTarget) {
      setValue(safeTarget);
      return;
    }

    const from = displayed.current;
    const startedAt = Date.now();
    let frame = 0;
    const step = () => {
      const next = countUpValue(from, safeTarget, Date.now() - startedAt, durationMs);
      displayed.current = next;
      setValue(next);
      if (next !== safeTarget) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [safeTarget, animate, durationMs]);

  return animate ? value : safeTarget;
}
