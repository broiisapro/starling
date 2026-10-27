/**
 * Minimal windowing for the activity list. 500 events is well past the point where rendering every
 * row is wasteful, but the rows are prose and vary in height, so this uses a fixed estimate and
 * over-scans generously. Below the threshold everything renders (tests and short sessions).
 */
export interface WindowInput {
  count: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan?: number;
  threshold?: number;
}

export interface WindowRange {
  start: number;
  end: number;
  topPad: number;
  bottomPad: number;
  virtualized: boolean;
}

export const DEFAULT_ROW_HEIGHT = 76;
export const VIRTUALIZE_AFTER = 80;

export function computeWindow(input: WindowInput): WindowRange {
  const { count, scrollTop, viewportHeight, rowHeight } = input;
  const overscan = input.overscan ?? 8;
  const threshold = input.threshold ?? VIRTUALIZE_AFTER;

  if (count <= threshold || rowHeight <= 0) {
    return { start: 0, end: count, topPad: 0, bottomPad: 0, virtualized: false };
  }

  const safeScroll = Math.max(0, scrollTop);
  const firstVisible = Math.floor(safeScroll / rowHeight);
  const visibleCount = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(count, firstVisible + visibleCount + overscan);

  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: Math.max(0, (count - end) * rowHeight),
    virtualized: true,
  };
}

export function isAtBottom(
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  slack = 24,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= slack;
}
