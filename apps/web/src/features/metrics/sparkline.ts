/**
 * Hand-rolled sparkline geometry (no chart library — ARCHITECTURE L11 and the epic's "SVG preferred"
 * rule). Pure functions so the path can be unit-tested without rendering.
 */

export interface SparklinePoint {
  x: number;
  y: number;
}

export interface SparklineGeometry {
  /** SVG path for the line, or '' when there is nothing to draw. */
  path: string;
  /** Closed path under the line for a soft gradient fill, or '' for a single point. */
  areaPath: string;
  points: SparklinePoint[];
  min: number;
  max: number;
  /** y of the flat baseline (the area fill's bottom edge). */
  baselineY: number;
}

export interface SparklineOptions {
  width: number;
  height: number;
  /** Keeps the stroke and the end dot inside the viewBox. */
  padding?: number;
}

const DEFAULT_PADDING = 3;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Map a value series to a viewBox. Rules:
 * - Empty series → empty geometry (the caller renders a "no data" hint).
 * - One sample → a flat line at the right edge, so the newest sample is where the eye expects it.
 * - A flat series sits on the vertical midline instead of dividing by zero.
 * - Non-finite values are treated as 0; they never produce "NaN" in a path.
 */
export function sparklineGeometry(values: readonly number[], options: SparklineOptions): SparklineGeometry {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const padding = Math.min(options.padding ?? DEFAULT_PADDING, Math.max(0, (height - 1) / 2), width / 2);
  const left = padding;
  const right = width - padding;
  const top = padding;
  const bottom = height - padding;
  const midline = round2((top + bottom) / 2);

  const clean = values.map((value) => (Number.isFinite(value) ? Math.max(0, value) : 0));
  if (clean.length === 0) {
    return { path: '', areaPath: '', points: [], min: 0, max: 0, baselineY: round2(bottom) };
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min;

  if (clean.length === 1) {
    return {
      path: `M ${round2(left)} ${midline} L ${round2(right)} ${midline}`,
      areaPath: '',
      points: [{ x: round2(right), y: midline }],
      min,
      max,
      baselineY: round2(bottom),
    };
  }

  const step = (right - left) / (clean.length - 1);
  const points = clean.map((value, index) => {
    const ratio = span === 0 ? 0.5 : (value - min) / span;
    return {
      x: round2(left + step * index),
      y: round2(bottom - ratio * (bottom - top)),
    };
  });

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const areaPath =
    first === undefined || last === undefined
      ? ''
      : `${line} L ${last.x} ${round2(bottom)} L ${first.x} ${round2(bottom)} Z`;

  return { path: line, areaPath, points, min, max, baselineY: round2(bottom) };
}

/** Values of one metric across history, in order — the panel's sparkline input. */
export function seriesFromHistory<T>(
  history: readonly T[],
  pick: (item: T) => number,
  limit = 120,
): number[] {
  const slice = history.length > limit ? history.slice(history.length - limit) : history;
  return slice.map((item) => {
    const value = pick(item);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  });
}
