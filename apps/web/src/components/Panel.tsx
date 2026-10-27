import type { ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../lib/cn';

export interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** `aside` for the drawer, `section` (default) elsewhere. */
  as?: 'section' | 'aside' | 'div';
  id?: string;
  /** Panels that can grow (agent log) opt in to their own scrolling. */
  scroll?: boolean;
}

/**
 * The one container every region uses: a translucent glass card over the dusk sky, with a hairline,
 * a compact header and an optional action slot.
 */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  as = 'section',
  id,
  scroll = false,
}: PanelProps) {
  const generatedId = useId();
  const headingId = `${id ?? generatedId}-title`;
  const Tag = as;

  return (
    <Tag
      id={id}
      aria-labelledby={title === undefined ? undefined : headingId}
      className={cn(
        'glass flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-hairline bg-panel',
        className,
      )}
    >
      {title !== undefined || actions !== undefined ? (
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-[var(--spacing-panel)] py-2.5">
          <div className="min-w-0">
            {title !== undefined ? (
              <h2
                id={headingId}
                className="truncate text-heading font-semibold tracking-[-0.02em] text-ink-1"
              >
                {title}
              </h2>
            ) : null}
            {subtitle !== undefined ? (
              <p className="mt-0.5 truncate text-caption text-ink-3">{subtitle}</p>
            ) : null}
          </div>
          {actions !== undefined ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </header>
      ) : null}
      <div
        className={cn(
          'min-h-0 flex-1',
          scroll ? 'overflow-y-auto overscroll-contain' : 'overflow-hidden',
          bodyClassName,
        )}
      >
        {children}
      </div>
    </Tag>
  );
}
