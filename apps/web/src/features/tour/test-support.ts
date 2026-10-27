import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState, type SkyState } from '../../data/reducer';

/**
 * Shared fixtures for the tour tests. Kept out of `index.ts` on purpose: it is a test module, not
 * part of the public feature surface.
 */

/** The recorded launch-day run, replayed up to `index` events. Same recipe as every other feature. */
export function demoStateAt(index: number): SkyState {
  return applyEvents(createInitialState(), demoEvents().slice(0, index));
}

export interface StubRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * happy-dom has no layout engine: every `getBoundingClientRect()` is zero-sized, which the tour
 * correctly reads as "collapsed region". Component tests that want a real spotlight therefore stub
 * the prototype and restore it afterwards.
 */
export function stubRects(rects: Record<string, StubRect>): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    for (const [selector, rect] of Object.entries(rects)) {
      if (!this.matches(selector)) continue;
      return {
        x: rect.left,
        y: rect.top,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        toJSON: () => rect,
      } as DOMRect;
    }
    return original.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

export function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

/** A `matchMedia` stub that answers only the reduced-motion query. */
export function stubReducedMotion(matches: boolean): () => void {
  const original = window.matchMedia;
  const query = (media: string): MediaQueryList =>
    ({
      matches: media.includes('prefers-reduced-motion') ? matches : false,
      media,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: query });
  return () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: original });
  };
}
