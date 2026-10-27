/**
 * The three small primitives the settings drawer is built from. Kept local to the lane so the
 * drawer has no dependency on another feature's internals (Epic 118).
 */
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface SectionProps {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}

/** A labelled group with a hairline rule. `section` + `aria-label` keeps the heading structure flat. */
export function Section({ title, icon, children }: SectionProps) {
  return (
    <section
      aria-label={title}
      className="border-b border-hairline/70 px-[var(--spacing-panel)] py-3.5 last:border-b-0"
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-micro font-medium tracking-[0.08em] text-ink-4 uppercase">
        {icon !== undefined ? (
          <span className="[&>svg]:h-3 [&>svg]:w-3" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedRowProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange(value: T): void;
  hint?: string;
  testId?: string;
}

/** A row of mutually exclusive buttons (`aria-pressed`), reachable by Tab and Space/Enter. */
export function SegmentedRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hint,
  testId,
}: SegmentedRowProps<T>) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-caption text-ink-2">{label}</span>
        <fieldset
          aria-label={label}
          data-testid={testId}
          className="m-0 inline-flex items-center gap-0.5 rounded-lg border border-hairline bg-surface-1/70 p-0.5"
        >
          <legend className="sr-only">{label}</legend>
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(option.value)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-caption font-medium transition-colors motion-safe-only',
                  active
                    ? 'bg-surface-3 text-ink-1 shadow-sm'
                    : 'text-ink-3 hover:bg-surface-2 hover:text-ink-2',
                )}
              >
                {option.icon !== undefined ? (
                  <span className="[&>svg]:h-3 [&>svg]:w-3" aria-hidden="true">
                    {option.icon}
                  </span>
                ) : null}
                {option.label}
              </button>
            );
          })}
        </fieldset>
      </div>
      {hint !== undefined ? <p className="text-micro text-ink-4">{hint}</p> : null}
    </div>
  );
}

export interface SwitchRowProps {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  hint?: string;
}

/** A labelled on/off switch. The visible "On"/"Off" text is the state, not the label. */
export function SwitchRow({ label, checked, onChange, hint }: SwitchRowProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <span className="text-caption text-ink-2">{label}</span>
        {hint !== undefined ? <p className="text-micro text-ink-4">{hint}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'inline-flex min-w-14 shrink-0 items-center justify-center rounded-full border px-2.5 py-1 text-caption font-medium transition-colors motion-safe-only',
          checked
            ? 'border-teal-400/50 bg-teal-400/15 text-teal-100'
            : 'border-hairline-strong bg-surface-2 text-ink-3 hover:text-ink-2',
        )}
      >
        {checked ? 'On' : 'Off'}
      </button>
    </div>
  );
}
