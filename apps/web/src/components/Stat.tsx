import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export type StatTone = 'default' | 'accent' | 'success' | 'warn' | 'danger';

const VALUE_TONES: Record<StatTone, string> = {
  default: 'text-ink-1',
  accent: 'text-teal-200',
  success: 'text-emerald-200',
  warn: 'text-amber-200',
  danger: 'text-red-200',
};

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  className?: string;
}

/** A label, a number and a hint. The bottom strip is made of these. */
export function Stat({ label, value, hint, icon, tone = 'default', className }: StatProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="flex items-center gap-1 text-micro font-medium tracking-[0.08em] text-ink-4 uppercase">
        {icon !== undefined ? <span className="[&>svg]:h-3 [&>svg]:w-3">{icon}</span> : null}
        {label}
      </span>
      <span className={cn('truncate font-mono text-title font-semibold tabular-nums', VALUE_TONES[tone])}>
        {value}
      </span>
      {hint !== undefined ? <span className="truncate text-caption text-ink-4">{hint}</span> : null}
    </div>
  );
}
