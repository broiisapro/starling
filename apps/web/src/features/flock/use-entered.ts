import { useEffect, useState } from 'react';

/**
 * Flip to `true` one frame after mount so the card transitions from "below and transparent" to its
 * resting position. Under reduced motion it starts settled — no frame hop, no transition.
 */
export function useEntered(reducedMotion: boolean): boolean {
  const [entered, setEntered] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) {
      setEntered(true);
      return;
    }
    setEntered(false);
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [reducedMotion]);

  return entered;
}
