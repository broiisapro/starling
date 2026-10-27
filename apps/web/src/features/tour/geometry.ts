import type { TourPlacement } from './types';

/** Plain rectangle in viewport coordinates (CSS px, origin top-left). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of the viewport we may use. */
export interface Viewport {
  width: number;
  height: number;
}

export interface CardSize {
  width: number;
  height: number;
}

/** A placed card, plus the placement that actually won after flipping. */
export interface PlacedCard extends Rect {
  placement: TourPlacement;
}

/** Anything with a DOM-style bounding box: an Element, a DOMRect, or a test double. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Keep the card this far from every viewport edge, so it never looks clipped by the projector. */
export const VIEWPORT_MARGIN = 12;
/** Gap between the spotlight and the card. */
export const CARD_GAP = 14;

const OPPOSITE: Record<TourPlacement, TourPlacement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
  center: 'center',
};

function clamp(value: number, min: number, max: number): number {
  // A card bigger than the viewport cannot satisfy both edges; pinning to the near edge is the
  // least-bad answer and leaves the far edge for the browser to clip.
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * The cut-out around an anchor: the element's box, grown by `padding`, intersected with the
 * viewport. Returns `undefined` when there is nothing worth highlighting — no element, a zero-sized
 * box (a collapsed region or a `display: none` drawer) or a box entirely off screen. Every caller
 * treats that as "show a centred card", which is what keeps the tour unstuck.
 */
export function spotlightRect(
  target: RectLike | null | undefined,
  padding: number,
  viewport: Viewport,
): Rect | undefined {
  if (target === null || target === undefined) return undefined;
  // A collapsed region, a `display: none` drawer or an empty container has a zero-sized box; padding
  // it would invent a spotlight around nothing.
  if (!(target.width > 0) || !(target.height > 0)) return undefined;
  const pad = Math.max(0, padding);
  const left = Math.max(0, target.left - pad);
  const top = Math.max(0, target.top - pad);
  const right = Math.min(viewport.width, target.left + target.width + pad);
  const bottom = Math.min(viewport.height, target.top + target.height + pad);
  const width = right - left;
  const height = bottom - top;
  if (!(width > 0) || !(height > 0)) return undefined;
  return { x: Math.round(left), y: Math.round(top), width: Math.round(width), height: Math.round(height) };
}

function centre(card: CardSize, viewport: Viewport): { x: number; y: number } {
  return {
    x: clamp(
      (viewport.width - card.width) / 2,
      VIEWPORT_MARGIN,
      viewport.width - card.width - VIEWPORT_MARGIN,
    ),
    y: clamp(
      (viewport.height - card.height) / 2,
      VIEWPORT_MARGIN,
      viewport.height - card.height - VIEWPORT_MARGIN,
    ),
  };
}

function candidate(
  target: Rect,
  card: CardSize,
  placement: TourPlacement,
  viewport: Viewport,
): { x: number; y: number } {
  const centredX = target.x + (target.width - card.width) / 2;
  const centredY = target.y + (target.height - card.height) / 2;
  switch (placement) {
    case 'top':
      return { x: centredX, y: target.y - CARD_GAP - card.height };
    case 'bottom':
      return { x: centredX, y: target.y + target.height + CARD_GAP };
    case 'left':
      return { x: target.x - CARD_GAP - card.width, y: centredY };
    case 'right':
      return { x: target.x + target.width + CARD_GAP, y: centredY };
    case 'center':
      return centre(card, viewport);
  }
}

function fits(position: { x: number; y: number }, card: CardSize, viewport: Viewport): boolean {
  return (
    position.x >= VIEWPORT_MARGIN &&
    position.y >= VIEWPORT_MARGIN &&
    position.x + card.width <= viewport.width - VIEWPORT_MARGIN &&
    position.y + card.height <= viewport.height - VIEWPORT_MARGIN
  );
}

/**
 * Put the card next to the target, then keep it on screen.
 *
 * Order of preference: the requested side if it fits → the opposite side if that fits → the
 * requested side clamped into the viewport. A `center` placement (or no target at all) ignores the
 * target entirely. Pure: pass a `Rect` and get numbers back, so the whole tour's layout is testable
 * without a browser.
 */
export function placeCard(
  target: Rect | undefined,
  card: CardSize,
  viewport: Viewport,
  placement: TourPlacement,
): PlacedCard {
  const size: CardSize = {
    width: Math.min(card.width, Math.max(0, viewport.width - VIEWPORT_MARGIN * 2)),
    height: Math.min(card.height, Math.max(0, viewport.height - VIEWPORT_MARGIN * 2)),
  };

  if (target === undefined || placement === 'center') {
    const spot = centre(size, viewport);
    return {
      x: Math.round(spot.x),
      y: Math.round(spot.y),
      width: size.width,
      height: size.height,
      placement: 'center',
    };
  }

  const preferred = candidate(target, size, placement, viewport);
  let used: TourPlacement = placement;
  let chosen = preferred;
  if (!fits(preferred, size, viewport)) {
    const flipped = OPPOSITE[placement];
    const alternative = candidate(target, size, flipped, viewport);
    if (fits(alternative, size, viewport)) {
      used = flipped;
      chosen = alternative;
    }
  }

  const x = clamp(chosen.x, VIEWPORT_MARGIN, viewport.width - size.width - VIEWPORT_MARGIN);
  const y = clamp(chosen.y, VIEWPORT_MARGIN, viewport.height - size.height - VIEWPORT_MARGIN);
  return { x: Math.round(x), y: Math.round(y), width: size.width, height: size.height, placement: used };
}
