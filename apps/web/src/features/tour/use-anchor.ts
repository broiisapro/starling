import { useEffect, useLayoutEffect, useState } from 'react';
import { FALLBACK_VIEWPORT } from './constants';
import { type Rect, type RectLike, spotlightRect, type Viewport } from './geometry';

/** Everything the overlay needs to know about the current step's anchor. */
export interface AnchorMeasurement {
  /** The cut-out, when the anchor exists, has a box and intersects the viewport. */
  spotlight?: Rect;
}

export function currentViewport(): Viewport {
  if (typeof window === 'undefined') return FALLBACK_VIEWPORT;
  return {
    width: window.innerWidth > 0 ? window.innerWidth : FALLBACK_VIEWPORT.width,
    height: window.innerHeight > 0 ? window.innerHeight : FALLBACK_VIEWPORT.height,
  };
}

/** Window size as state, so a projector resolution change re-lays-out the card. */
export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(currentViewport);
  useEffect(() => {
    const onResize = (): void => setViewport(currentViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return viewport;
}

function sameBox(a: RectLike | undefined, b: RectLike): boolean {
  return (
    a !== undefined && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
  );
}

/**
 * Find the step's anchor and keep its box current.
 *
 * Three failure modes have to end in a centred card rather than a stuck tour:
 * 1. the selector matches nothing yet — a `MutationObserver` waits for a region to mount (the drawer
 *    is created on demand, the bottom strip collapses);
 * 2. the element is collapsed or `display: none` — its box is zero-sized, so `spotlightRect` says no;
 * 3. the window moved under us — resize and scroll re-measure, `ResizeObserver` catches layout
 *    changes (guarded: happy-dom has none), and every render re-reads the box as a backstop.
 */
export function useAnchor(
  selector: string | undefined,
  viewport: Viewport,
  padding: number,
): AnchorMeasurement {
  const [element, setElement] = useState<Element | null>(null);
  const [box, setBox] = useState<RectLike | undefined>(undefined);

  useEffect(() => {
    if (selector === undefined || typeof document === 'undefined') {
      setElement(null);
      return;
    }
    const lookup = (): Element | null => document.querySelector(selector);
    const first = lookup();
    setElement(first);
    if (first !== null) return;
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      const late = lookup();
      if (late === null) return;
      observer.disconnect();
      setElement(late);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'data-active'],
    });
    return () => observer.disconnect();
  }, [selector]);

  useEffect(() => {
    if (element === null) {
      setBox(undefined);
      return;
    }
    const measure = (): void => {
      const measured = element.getBoundingClientRect();
      const next: RectLike = {
        left: measured.left,
        top: measured.top,
        width: measured.width,
        height: measured.height,
      };
      // Compare before storing: an identical box must not schedule another render.
      setBox((previous) => (sameBox(previous, next) ? previous : next));
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(element);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      observer?.disconnect();
    };
  }, [element]);

  // Remeasure after every render as well: the shell can open the drawer (or un-collapse a region)
  // without resizing anything, and not every such change fires a ResizeObserver in every browser.
  useLayoutEffect(() => {
    if (element === null) return;
    const measured = element.getBoundingClientRect();
    const next: RectLike = {
      left: measured.left,
      top: measured.top,
      width: measured.width,
      height: measured.height,
    };
    setBox((previous) => (sameBox(previous, next) ? previous : next));
  });

  return {
    spotlight: spotlightRect(box, padding, viewport),
  };
}
