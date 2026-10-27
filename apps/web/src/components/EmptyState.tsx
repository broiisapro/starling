import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

/** The quiet, friendly "nothing here yet" state. Never an error: the sky is just empty. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col items-center justify-center gap-2 text-center',
        compact ? 'px-3 py-4' : 'px-6 py-8',
        className,
      )}
    >
      {icon !== undefined ? <div className="text-ink-4 [&>svg]:h-6 [&>svg]:w-6">{icon}</div> : null}
      <p className={cn('font-medium text-ink-2', compact ? 'text-caption' : 'text-body')}>{title}</p>
      {description !== undefined ? <p className="max-w-64 text-caption text-ink-4">{description}</p> : null}
      {action !== undefined ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
