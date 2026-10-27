import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info' | 'violet';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-hairline-strong bg-surface-3/60 text-ink-2',
  accent: 'border-teal-400/40 bg-teal-400/15 text-teal-200',
  success: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200',
  warn: 'border-amber-400/40 bg-amber-400/15 text-amber-200',
  danger: 'border-red-400/40 bg-red-400/15 text-red-200',
  info: 'border-sky-400/40 bg-sky-400/15 text-sky-200',
  violet: 'border-violet-400/40 bg-violet-400/15 text-violet-200',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Leading mark, e.g. a StatusDot or an icon. */
  icon?: ReactNode;
  className?: string;
  title?: string;
}

/** Compact status pill. Uses literal class strings so Tailwind's scanner sees every tone. */
export function Badge({ children, tone = 'neutral', icon, className, title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-pill)] border px-2 py-0.5 text-caption font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
