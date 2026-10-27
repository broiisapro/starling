import { describe, expect, test } from 'bun:test';
import { placeCard, spotlightRect, VIEWPORT_MARGIN, type Viewport } from './geometry';

const VIEWPORT: Viewport = { width: 1000, height: 800 };
const CARD = { width: 300, height: 150 };

describe('spotlightRect', () => {
  test('grows the anchor box by the requested padding', () => {
    const rect = spotlightRect({ left: 100, top: 100, width: 200, height: 100 }, 8, VIEWPORT);
    expect(rect).toEqual({ x: 92, y: 92, width: 216, height: 116 });
  });

  test('intersects the box with the viewport instead of hanging off the edge', () => {
    const rect = spotlightRect({ left: -50, top: -20, width: 100, height: 50 }, 10, VIEWPORT);
    expect(rect).toEqual({ x: 0, y: 0, width: 60, height: 40 });
  });

  test('returns undefined when there is no element', () => {
    expect(spotlightRect(null, 8, VIEWPORT)).toBeUndefined();
    expect(spotlightRect(undefined, 8, VIEWPORT)).toBeUndefined();
  });

  test('returns undefined for a collapsed or hidden region (zero-sized box)', () => {
    expect(spotlightRect({ left: 0, top: 0, width: 0, height: 0 }, 8, VIEWPORT)).toBeUndefined();
    expect(spotlightRect({ left: 400, top: 300, width: 0, height: 120 }, 8, VIEWPORT)).toBeUndefined();
  });

  test('returns undefined when the box is entirely off screen', () => {
    expect(spotlightRect({ left: 1200, top: 40, width: 100, height: 100 }, 8, VIEWPORT)).toBeUndefined();
  });
});

describe('placeCard', () => {
  test('uses the requested side when the card fits there', () => {
    const placed = placeCard({ x: 100, y: 100, width: 200, height: 100 }, CARD, VIEWPORT, 'bottom');
    expect(placed).toEqual({ x: 50, y: 214, width: 300, height: 150, placement: 'bottom' });
  });

  test('flips from bottom to top when the card would overflow the viewport', () => {
    const placed = placeCard({ x: 100, y: 700, width: 200, height: 80 }, CARD, VIEWPORT, 'bottom');
    expect(placed.placement).toBe('top');
    expect(placed.y).toBe(536);
  });

  test('flips from right to left when the anchor sits against the right edge', () => {
    const placed = placeCard({ x: 700, y: 200, width: 250, height: 150 }, CARD, VIEWPORT, 'right');
    expect(placed.placement).toBe('left');
    expect(placed.x).toBe(386);
  });

  test('clamps a card into the viewport when neither side fits', () => {
    const placed = placeCard({ x: 0, y: 0, width: 980, height: 780 }, CARD, VIEWPORT, 'right');
    // Preferred position 994 is past the right margin and the flipped one is negative: clamp wins.
    expect(placed.placement).toBe('right');
    expect(placed.x).toBe(VIEWPORT.width - CARD.width - VIEWPORT_MARGIN);
    expect(placed.y).toBe(315);
  });

  test('centres the card when there is no target', () => {
    const placed = placeCard(undefined, CARD, VIEWPORT, 'bottom');
    expect(placed).toEqual({ x: 350, y: 325, width: 300, height: 150, placement: 'center' });
  });

  test('ignores the target for a centre placement', () => {
    const placed = placeCard({ x: 100, y: 100, width: 200, height: 100 }, CARD, VIEWPORT, 'center');
    expect(placed.placement).toBe('center');
    expect(placed.x).toBe(350);
    expect(placed.y).toBe(325);
  });

  test('shrinks the card to the viewport minus the margins', () => {
    const placed = placeCard(undefined, { width: 600, height: 150 }, { width: 250, height: 800 }, 'bottom');
    expect(placed.width).toBe(226);
    expect(placed.x).toBe(VIEWPORT_MARGIN);
  });

  test('keeps the top-left corner inside the margin even for a negative target', () => {
    const placed = placeCard({ x: -100, y: -100, width: 50, height: 50 }, CARD, VIEWPORT, 'top');
    expect(placed.x).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(placed.y).toBe(VIEWPORT_MARGIN);
  });
});
