import { create } from 'qrcode';
import { useMemo } from 'react';
import { cx } from './cx';

export interface QrCodeProps {
  value: string;
  /** Rendered size in CSS pixels; the SVG scales to any container. */
  size?: number;
  className?: string;
  label?: string;
}

export type QrMatrix = { ok: true; size: number; path: string } | { ok: false; message: string };

const QUIET_ZONE = 2;

/**
 * Build the module matrix synchronously (no canvas, no async renderer) and flatten it into one path.
 * Keeping this pure makes it testable and keeps the browser bundle free of the canvas renderer.
 */
export function qrMatrix(value: string): QrMatrix {
  if (value.length === 0) return { ok: false, message: 'nothing to encode' };
  try {
    const matrix = create(value, { errorCorrectionLevel: 'M' });
    const size = matrix.modules.size;
    let path = '';
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        if (matrix.modules.data[row * size + column] === 1) {
          path += `M${column} ${row}h1v1h-1z`;
        }
      }
    }
    return { ok: true, size, path };
  } catch (error) {
    // A payload too long for a QR symbol must not take the dashboard down; the command is copied.
    const message = error instanceof Error ? error.message : 'could not render a QR code';
    return { ok: false, message };
  }
}

/**
 * Scannable join QR: dark modules on a white quiet zone (never themed, or phones stop reading it),
 * drawn as a single path with crisp edges.
 */
export function QrCode({ value, size = 112, className, label = 'Join QR code' }: QrCodeProps) {
  const matrix = useMemo(() => qrMatrix(value), [value]);

  if (!matrix.ok) {
    return (
      <div
        data-testid="join-qr-error"
        data-qr-error={matrix.message}
        className={cx(
          'grid place-items-center rounded-lg border border-dashed border-white/15 bg-white/5 p-3',
          'text-center text-[10px] leading-tight text-slate-400',
          className,
        )}
        style={{ width: size, height: size }}
      >
        QR unavailable
      </div>
    );
  }

  const extent = matrix.size + QUIET_ZONE * 2;
  return (
    <svg
      data-testid="join-qr"
      data-qr-value={value}
      role="img"
      aria-label={label}
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${extent} ${extent}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cx('rounded-lg bg-white shadow-[0_8px_24px_-12px_rgba(56,189,248,0.6)]', className)}
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={extent} height={extent} fill="#ffffff" />
      <path d={matrix.path} fill="#0b1220" />
    </svg>
  );
}
