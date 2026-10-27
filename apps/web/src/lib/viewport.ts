import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query from React.
 *
 * The shell uses it for *content* decisions a container query cannot make (the flock rail shows
 * roost cards on a projector and one compact row on a small laptop). `initial` is what a test or a
 * server render sees when `matchMedia` is unavailable, so callers pick the safer default.
 */
export function useMediaQuery(query: string, initial = true): boolean {
  const read = (): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return initial;
    return window.matchMedia(query).matches;
  };
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    }
    // Safari < 14 only has the deprecated listener API.
    list.addListener(onChange);
    return () => list.removeListener(onChange);
  }, [query]);

  return matches;
}

/**
 * Roost cards need a full-height rail and room for their chips; on a 720p laptop the compact roost
 * row fits the same two machines without scrolling. 800px of height is the line where the cards stop
 * being a scroll hunt on stage.
 */
export const WIDE_FLOCK_QUERY = '(min-width: 1180px) and (min-height: 800px)';

export function useWideFlock(): boolean {
  return useMediaQuery(WIDE_FLOCK_QUERY);
}
