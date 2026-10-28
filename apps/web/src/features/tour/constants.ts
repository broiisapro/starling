import type { CardSize } from './geometry';

/** Fixed card width: a predictable card size is what makes the placement maths testable. */
export const CARD_WIDTH = 360;

/** Used until the card has been measured (and in happy-dom, which has no layout engine). */
export const CARD_ESTIMATE: CardSize = { width: CARD_WIDTH, height: 210 };

/** Breathing room between the anchor and the dimmed edge of the cut-out. */
export const SPOTLIGHT_PADDING = 8;

/** Viewport used when there is no `window` (SSR, a unit test without a DOM). */
export const FALLBACK_VIEWPORT = { width: 1280, height: 720 } as const;
