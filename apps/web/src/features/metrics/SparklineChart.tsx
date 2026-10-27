import { sparklineGeometry } from './sparkline';

export interface SparklineChartProps {
  values: readonly number[];
  /** Accessible name; also used as the SVG `<title>`. */
  label: string;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * A hand-rolled sparkline. `viewBox` + `width="100%"` makes it responsive without re-measuring, and
 * `vectorEffect="non-scaling-stroke"` keeps the stroke one and a half pixels when it stretches.
 * The decorative shapes are hidden from assistive tech; the accessible summary is the label.
 */
export function SparklineChart({ values, label, width = 140, height = 32, className }: SparklineChartProps) {
  const geometry = sparklineGeometry(values, { width, height, padding: 3 });
  const end = geometry.points[geometry.points.length - 1];
  const hasData = geometry.path !== '';

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={className}
      data-testid="sparkline"
    >
      <title>{label}</title>
      <desc>
        {hasData
          ? `${values.length} samples, minimum ${geometry.min}, maximum ${geometry.max}`
          : 'No samples yet'}
      </desc>
      {hasData ? (
        <g>
          {geometry.areaPath === '' ? null : (
            <path d={geometry.areaPath} fill="#38bdf8" fillOpacity={0.14} stroke="none" />
          )}
          <path
            d={geometry.path}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {end === undefined ? null : <circle cx={end.x} cy={end.y} r={1.6} fill="#bae6fd" />}
        </g>
      ) : (
        <g>
          <line
            x1={3}
            y1={height / 2}
            x2={width - 3}
            y2={height / 2}
            stroke="#334155"
            strokeWidth={1}
            strokeDasharray="2 3"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
    </svg>
  );
}
