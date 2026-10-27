import { useEffect, useState } from 'react';

/**
 * The clock used for "last seen" labels. When the shell pins `now` (replay, the fixture playground)
 * that value wins and nothing ticks. Otherwise the panel re-renders once a second so an offline
 * roost's age keeps climbing without waiting for another event.
 */
export function useNow(pinned?: number): number {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (pinned !== undefined) return;
    const timer = setInterval(() => setTick(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [pinned]);

  return pinned ?? tick;
}
