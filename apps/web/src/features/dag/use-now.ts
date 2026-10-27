import { useEffect, useState } from 'react';

/**
 * A once-a-second clock that only ticks while something is live. Frozen when `active` is false so a
 * finished run does not re-render the whole graph forever.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);

  return now;
}
