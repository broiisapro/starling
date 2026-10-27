import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface KbdProps {
  children: ReactNode;
  /** e.g. "then" between two keys. */
  className?: string;
  size?: 'sm' | 'md';
}

/** Keyboard hint. Rendered as a real <kbd> so screen readers announce it as a key. */
export function Kbd({ children, className, size = 'md' }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center rounded-md border border-hairline-strong bg-surface-3/70 font-mono text-ink-2 shadow-[inset_0_-1px_0_rgba(0,0,0,0.35)]',
        size === 'sm' ? 'min-h-4 min-w-4 px-1 text-[10px]' : 'min-h-5 min-w-5 px-1.5 text-micro',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
