import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
  useState,
} from 'react';
import { cn } from '../lib/cn';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}

/**
 * Hover/focus tooltip with `role="tooltip"` and `aria-describedby` on the trigger itself.
 *
 * The listeners are cloned onto the child rather than put on the wrapper: that keeps the wrapper
 * non-interactive (and honest to assistive tech) and makes the description point at the control the
 * user actually focused. A child with its own handlers would have them replaced; none of the shell
 * tooltips have any.
 */
export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  const trigger =
    isValidElement(children) && Children.count(children) === 1
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          'aria-describedby': visible ? id : undefined,
          onMouseEnter: () => setVisible(true),
          onMouseLeave: () => setVisible(false),
          onFocus: () => setVisible(true),
          onBlur: () => setVisible(false),
        })
      : children;

  return (
    <span className={cn('relative inline-flex', className)}>
      {trigger}
      <span
        id={id}
        role="tooltip"
        hidden={!visible}
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-md border border-hairline-strong bg-surface-3 px-2 py-1 text-caption text-ink-1 shadow-lg',
          side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
        )}
      >
        {content}
      </span>
    </span>
  );
}
