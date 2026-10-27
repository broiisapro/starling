import type { TaskStatus } from '@starling/core';
import { cn } from '../lib/cn';
import { STATUS_COLORS } from '../lib/status';

export interface StatusDotProps {
  status: TaskStatus;
  /** Adds a ping ring for in-flight states (running, auditing, fixing, merging). */
  pulse?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Show the status label next to the dot. */
  withLabel?: boolean;
}

const SIZES = { sm: 'h-1.5 w-1.5', md: 'h-2 w-2', lg: 'h-2.5 w-2.5' } as const;
const PULSE_STATUSES: readonly TaskStatus[] = ['running', 'auditing', 'fixing', 'merging'];

/**
 * A task-status dot. Colour comes from the shared palette (inline style, so it also matches the
 * Canvas birds exactly) and the label is always available to screen readers.
 */
export function StatusDot({ status, pulse, size = 'md', className, withLabel = false }: StatusDotProps) {
  const palette = STATUS_COLORS[status];
  const shouldPulse = pulse ?? PULSE_STATUSES.includes(status);

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span
        className="relative inline-flex"
        role="img"
        aria-label={`${palette.label}: ${palette.description}`}
      >
        {shouldPulse ? (
          <span
            className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
              SIZES[size],
            )}
            style={{ backgroundColor: palette.hex }}
          />
        ) : null}
        <span
          className={cn('relative inline-flex rounded-full ring-2 ring-black/20', SIZES[size])}
          style={{ backgroundColor: palette.hex }}
        />
      </span>
      {withLabel ? <span className={cn('text-caption', palette.text)}>{palette.label}</span> : null}
    </span>
  );
}
