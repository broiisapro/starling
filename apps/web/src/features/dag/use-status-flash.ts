import { useEffect, useRef, useState } from 'react';

/** How long a card glows after its status changes. Long enough to notice, short enough to be calm. */
export const STATUS_FLASH_MS = 700;

/**
 * True for a moment after `status` changes, so the card can play an arrival glow.
 *
 * The first render never flashes (a card that mounts already `running` is not a transition). The
 * timer is cleared on unmount and on a second change, so a fast replay collapses to one glow instead
 * of stacking animations. Reduced motion is handled by the stylesheet, which drops the animation
 * entirely rather than shortening it.
 */
export function useStatusFlash(status: string): boolean {
  const previous = useRef(status);
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), STATUS_FLASH_MS);
    return () => clearTimeout(timer);
  }, [status]);

  return flashing;
}
