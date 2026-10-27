/**
 * Windowing for one queue column.
 *
 * The board is a six-column scroller, so a run with 40 tasks in "On the wire" would otherwise
 * render 40 buttons inside a 190 px strip. Cards are a fixed height, which makes a window cheap:
 * two spacer rows keep the scrollbar honest and only the visible cards (plus four of overscan each
 * way) are mounted.
 *
 * Below the threshold everything renders — a 7-task demo should not pay for virtualisation, and
 * tests can query every card.
 */
export interface ColumnWindowInput {
  count: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight?: number;
  overscan?: number;
  threshold?: number;
}

export interface ColumnWindow {
  start: number;
  end: number;
  topPad: number;
  bottomPad: number;
  virtualized: boolean;
}

/** Card height (two text lines + padding) plus the 6 px gap between cards. */
export const QUEUE_ROW_HEIGHT = 74;
export const QUEUE_VIRTUALIZE_AFTER = 30;

export function columnWindow(input: ColumnWindowInput): ColumnWindow {
  const { count, scrollTop, viewportHeight } = input;
  const rowHeight = input.rowHeight ?? QUEUE_ROW_HEIGHT;
  const overscan = input.overscan ?? 4;
  const threshold = input.threshold ?? QUEUE_VIRTUALIZE_AFTER;

  if (count <= threshold || rowHeight <= 0) {
    return { start: 0, end: count, topPad: 0, bottomPad: 0, virtualized: false };
  }

  const safeScroll = Math.max(0, scrollTop);
  const firstVisible = Math.floor(safeScroll / rowHeight);
  const visible = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1);
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(count, firstVisible + visible + overscan);

  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: Math.max(0, (count - end) * rowHeight),
    virtualized: true,
  };
}
