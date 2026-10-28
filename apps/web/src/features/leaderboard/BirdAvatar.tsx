import { useId } from 'react';
import { birdAvatar, plumageColor } from './avatar';

export interface BirdAvatarProps {
  /** Task key or node id: the same seed always draws the same bird. */
  seed: string;
  /** 16–24 px, per the design brief. Clamped so a stray value cannot break the dock layout. */
  size?: number;
  className?: string;
}

const INK = '#0b1229';
const BEAK = '#f2a65a';

/**
 * A starling, 24×24, generated from a seed.
 *
 * Decorative by contract: the entry's label sits next to it in the real UI, so the SVG is
 * `aria-hidden` rather than announcing a meaningless "image". Speckles are clipped to the body so
 * the plumage never bleeds past the silhouette at 16 px.
 */
export function BirdAvatar({ seed, size = 20, className }: BirdAvatarProps) {
  const spec = birdAvatar(seed);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const gradientId = `bird-gradient-${uid}`;
  const clipId = `bird-clip-${uid}`;
  const pixels = Math.min(24, Math.max(16, Math.round(size)));

  return (
    <svg
      data-testid="bird-avatar"
      data-pattern={spec.pattern}
      data-eye={spec.eye}
      width={pixels}
      height={pixels}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor={plumageColor(spec.hue, 78, 66)} />
          <stop offset="55%" stopColor={plumageColor(spec.hue, 64, 52)} />
          <stop offset="100%" stopColor={plumageColor(spec.accentHue, 58, 36)} />
        </linearGradient>
        <clipPath id={clipId}>
          <ellipse cx="12" cy="12.9" rx="4.7" ry="5.1" />
          <circle cx="12" cy="7.1" r="3.3" />
        </clipPath>
      </defs>

      <g transform={`rotate(${spec.tilt} 12 12)`}>
        <path d="M12 16.4l-2.2 4.1 2.2-1.1 2.2 1.1z" fill={plumageColor(spec.accentHue, 62, 34)} />
        <ellipse cx="12" cy="12.9" rx="4.7" ry="5.1" fill={`url(#${gradientId})`} />
        <circle cx="12" cy="7.1" r="3.3" fill={`url(#${gradientId})`} />
        <path d="M12 2.6l1.5 2.8h-3z" fill={BEAK} />

        <g clipPath={`url(#${clipId})`}>
          {spec.speckles.map((speckle) => (
            <SpeckleMark
              key={`${speckle.cx}-${speckle.cy}`}
              pattern={spec.pattern}
              cx={speckle.cx}
              cy={speckle.cy}
              r={speckle.r}
              color={plumageColor(speckle.hue, 82, 70)}
              opacity={speckle.opacity}
            />
          ))}
        </g>

        <Wing wing={spec.wing} hue={spec.hue} />
        <Eyes eye={spec.eye} />
      </g>
    </svg>
  );
}

interface SpeckleMarkProps {
  pattern: ReturnType<typeof birdAvatar>['pattern'];
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
}

function SpeckleMark({ pattern, cx, cy, r, color, opacity }: SpeckleMarkProps) {
  if (pattern === 'streak') {
    return (
      <rect
        x={cx - r * 0.45}
        y={cy - r * 1.3}
        width={r * 0.9}
        height={r * 2.6}
        rx={r * 0.45}
        fill={color}
        opacity={opacity}
      />
    );
  }
  if (pattern === 'spangle') {
    return (
      <rect
        x={cx - r * 0.7}
        y={cy - r * 0.7}
        width={r * 1.4}
        height={r * 1.4}
        rx={r * 0.2}
        fill={color}
        opacity={opacity}
        transform={`rotate(45 ${cx} ${cy})`}
      />
    );
  }
  if (pattern === 'dapple') {
    return <circle cx={cx} cy={cy} r={r * 1.6} fill={color} opacity={opacity * 0.65} />;
  }
  return <circle cx={cx} cy={cy} r={r} fill={color} opacity={opacity} />;
}

function Wing({ wing, hue }: { wing: ReturnType<typeof birdAvatar>['wing']; hue: number }) {
  const dark = plumageColor(hue, 70, 32);
  if (wing === 'open') {
    return (
      <g fill={dark} opacity="0.62">
        <path d="M8.4 11.4 4 8.7c-.5-.3-1.1.2-.8.8l2.4 4.1z" />
        <path d="M15.6 11.4 20 8.7c.5-.3 1.1.2.8.8l-2.4 4.1z" />
      </g>
    );
  }
  if (wing === 'flick') {
    return (
      <g fill={dark} opacity="0.7">
        <path d="M8.9 10.6c1.3-.5 2.4-.2 3 .7-.8.6-1.8.9-3 .7z" />
        <path d="M15.1 10.6c-1.3-.5-2.4-.2-3 .7.8.6 1.8.9 3 .7z" />
      </g>
    );
  }
  return (
    <g fill={dark} opacity="0.55">
      <ellipse cx="9.4" cy="13.1" rx="1.3" ry="2.9" transform="rotate(10 9.4 13.1)" />
      <ellipse cx="14.6" cy="13.1" rx="1.3" ry="2.9" transform="rotate(-10 14.6 13.1)" />
    </g>
  );
}

function Eyes({ eye }: { eye: ReturnType<typeof birdAvatar>['eye'] }) {
  if (eye === 'half') {
    return (
      <g stroke={INK} strokeWidth="0.7" strokeLinecap="round">
        <path d="M9.9 7h1.3" />
        <path d="M12.8 7h1.3" />
      </g>
    );
  }
  if (eye === 'wide') {
    return (
      <g>
        <circle cx="10.5" cy="7.1" r="0.95" fill="#f5f7ff" />
        <circle cx="13.5" cy="7.1" r="0.95" fill="#f5f7ff" />
        <circle cx="10.5" cy="7.1" r="0.48" fill={INK} />
        <circle cx="13.5" cy="7.1" r="0.48" fill={INK} />
      </g>
    );
  }
  return (
    <g fill={INK}>
      <circle cx="10.5" cy="7.1" r="0.62" />
      <circle cx="13.5" cy="7.1" r="0.62" />
    </g>
  );
}
