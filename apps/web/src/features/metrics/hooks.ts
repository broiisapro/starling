/**
 * Tiny hooks shared by the bottom-strip features (metrics panel + queue board).
 *
 * Both imports are intra-lane (`features/metrics` → `features/queue`); at C1 these belong in
 * `src/lib/` (Epic 23). They are kept dependency-free and SSR-safe on purpose.
 */
import { useEffect, useState } from 'react';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** System reduced-motion preference, guarded for happy-dom/SSR and older `matchMedia` shims. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Subscribes to `prefers-reduced-motion`. Components reflect it as `data-reduced-motion`, which the
 * shared stylesheet turns into a 0 ms transition duration — animation is off, not merely shorter.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * A coarse `Date.now()` heartbeat so elapsed clocks tick between event samples.
 *
 * `active: false` freezes the value (and stops the interval, which matters when 20 agents share a
 * laptop). The interval is deliberately 1 s: the counters show whole seconds.
 */
export function useNow(active: boolean, intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    if (!active || intervalMs <= 0) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);

  return now;
}
