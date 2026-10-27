import { Check, Copy, TriangleAlert } from 'lucide-react';
import { cx } from './cx';
import { useCopy } from './use-copy';

export interface CopyButtonProps {
  value: string;
  /** Resting label, e.g. "Copy code". */
  label: string;
  /** Screen-reader name, e.g. "Copy join code". */
  ariaLabel: string;
  testId: string;
  className?: string;
}

/** Small copy affordance with a visible and announced confirmation. */
export function CopyButton({ value, label, ariaLabel, testId, className }: CopyButtonProps) {
  const { state, copy } = useCopy();
  const Icon = state === 'copied' ? Check : state === 'failed' ? TriangleAlert : Copy;

  return (
    <>
      <button
        type="button"
        data-testid={testId}
        data-copy-state={state}
        aria-label={ariaLabel}
        onClick={() => void copy(value)}
        className={cx(
          'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium',
          'transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2',
          'focus-visible:outline-sky-400',
          state === 'copied'
            ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
            : state === 'failed'
              ? 'border-rose-400/40 bg-rose-400/10 text-rose-200'
              : 'border-white/15 bg-white/5 text-slate-200 hover:border-white/25 hover:bg-white/10',
          className,
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Press ⌘C' : label}</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === 'copied' ? `${ariaLabel}: copied` : state === 'failed' ? `${ariaLabel}: copy failed` : ''}
      </span>
    </>
  );
}
