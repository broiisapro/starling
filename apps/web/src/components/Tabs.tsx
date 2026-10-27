import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { cn } from '../lib/cn';

export interface TabItem<T extends string | number = string> {
  id: T;
  label: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<T extends string | number = string> {
  tabs: readonly TabItem<T>[];
  value: T;
  onChange(value: T): void;
  /** Required: a tablist without a label is a mystery to screen readers. */
  ariaLabel: string;
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * Small accessible tablist: roving focus with ←/→/Home/End, `aria-selected`, and no dependency on
 * a UI library. Feature panels own their own tab panels; this is just the control.
 */
export function Tabs<T extends string | number = string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
  size = 'sm',
}: TabsProps<T>) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAndSelect = (index: number): void => {
    const wrapped = (index + tabs.length) % tabs.length;
    const tab = tabs[wrapped];
    if (tab === undefined || tab.disabled === true) return;
    buttons.current[wrapped]?.focus();
    onChange(tab.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = tabs.findIndex((tab) => tab.id === value);
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusAndSelect(current + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusAndSelect(current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAndSelect(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAndSelect(tabs.length - 1);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-hairline bg-surface-1/70 p-0.5',
        className,
      )}
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={undefined}
            disabled={tab.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors motion-safe-only disabled:cursor-not-allowed disabled:opacity-40',
              size === 'sm' ? 'px-2 py-1 text-caption' : 'px-3 py-1.5 text-body',
              selected
                ? 'bg-surface-3 text-ink-1 shadow-sm'
                : 'text-ink-3 hover:bg-surface-2 hover:text-ink-2',
            )}
          >
            {tab.label}
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}
