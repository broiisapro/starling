import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Kbd } from '../components';

export interface KeyboardHelpProps {
  open: boolean;
  onClose(): void;
}

interface Shortcut {
  keys: string[];
  action: string;
}

/** Everything the shell binds. Kept next to the handler so the overlay cannot drift from it. */
export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['1'], action: 'Sky — the murmuration' },
  { keys: ['2'], action: 'Flight plan — the task DAG' },
  { keys: ['b'], action: 'Show / hide the bottom strip' },
  { keys: ['f'], action: 'Show / hide the flock rail' },
  { keys: ['?'], action: 'This help' },
  { keys: ['Esc'], action: 'Close the drawer or this help' },
  { keys: ['←', '→', '↑', '↓'], action: 'Move between birds / tasks when a view has focus' },
];

/**
 * The `?` overlay: a small, dismissible card with every shell shortcut. Rendered only while open so
 * it never traps focus on stage; `Esc` and the backdrop both close it.
 */
export function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      data-testid="keyboard-help"
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/70 p-6 backdrop-blur-sm"
    >
      {/* A real button so pointer users can dismiss, keyboard users already have Esc. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close keyboard help"
        className="absolute inset-0 cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-help-title"
        className="relative w-full max-w-md rounded-[var(--radius-panel)] border border-hairline-strong bg-panel-strong p-5 shadow-[var(--shadow-panel)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="keyboard-help-title" className="text-heading font-semibold text-ink-1">
              Keyboard shortcuts
            </h2>
            <p className="mt-1 text-caption text-ink-3">Everything on stage is one key away.</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close keyboard help"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink-1"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <dl className="mt-4 flex flex-col gap-2">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.action} className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-1">
                {shortcut.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </dt>
              <dd className="text-right text-caption text-ink-2">{shortcut.action}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 border-t border-hairline pt-3 text-micro text-ink-4">
          Shortcuts pause while you are typing in the run picker or any text field.
        </p>
      </div>
    </div>
  );
}
