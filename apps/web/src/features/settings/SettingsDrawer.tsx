/**
 * The settings overlay (Epic 118): one right-side drawer, four groups, saved as you go.
 *
 * Accessibility is part of the feature, not a polish pass: a real `role="dialog"` with
 * `aria-modal`, focus moved in on open and restored on close, Tab trapped inside, Esc closes. The
 * drawer never reads the Sky store — it owns only settings — so C3 can mount it from the feature
 * registry and hand it `onClose` / `onSettingsChange`.
 */
import { Monitor, Moon, Palette, Plug, RotateCcw, Sun, Timer, Waves, X } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { ConnectionSection } from './ConnectionSection';
import { Section, SegmentedRow, SwitchRow } from './controls';
import { DEFAULT_SETTINGS, type SettingsPatch, type StarlingSettings } from './schema';
import type { SettingsStorage } from './storage';
import { useSettings } from './use-settings';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark', icon: <Moon /> },
  { value: 'light', label: 'Light', icon: <Sun /> },
  { value: 'system', label: 'System', icon: <Monitor /> },
] as const;

const DENSITY_OPTIONS = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
] as const;

const MOTION_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'full', label: 'Full' },
] as const;

const SPEED_OPTIONS = [
  { value: 1, label: '1×' },
  { value: 4, label: '4×' },
  { value: 16, label: '16×' },
] as const;

export interface SettingsDrawerProps {
  /** Called by the close button and Esc. C3 binds this to hiding the overlay. */
  onClose?(): void;
  /** Every accepted change, already normalised. C3 forwards theme/speed into the shell. */
  onSettingsChange?(next: StarlingSettings): void;
  /** Injected by tests and by hosts that wrap `fetch` (e.g. attaching the token). */
  fetchImpl?: typeof fetch;
  /** Injected by tests; defaults to a guarded `localStorage`. */
  storage?: SettingsStorage;
  className?: string;
}

export function SettingsDrawer({
  onClose,
  onSettingsChange,
  fetchImpl,
  storage,
  className,
}: SettingsDrawerProps) {
  const [settings, update] = useSettings({ storage });
  const [confirmingReset, setConfirmingReset] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const active = typeof document === 'undefined' ? null : document.activeElement;
    returnFocusRef.current =
      active !== null && typeof (active as HTMLElement).focus === 'function' ? (active as HTMLElement) : null;
    closeRef.current?.focus();
    return () => {
      returnFocusRef.current?.focus();
    };
  }, []);

  const focusableElements = (): HTMLElement[] => {
    const panel = panelRef.current;
    if (panel === null) return [];
    return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = focusableElements();
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    const active = typeof document === 'undefined' ? null : document.activeElement;
    const inside = active !== null && panelRef.current?.contains(active) === true;
    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const change = (patch: SettingsPatch): void => {
    const next = update(patch);
    onSettingsChange?.(next);
  };

  const reset = (): void => {
    change({
      theme: DEFAULT_SETTINGS.theme,
      motion: DEFAULT_SETTINGS.motion,
      sound: DEFAULT_SETTINGS.sound,
      demoSpeed: DEFAULT_SETTINGS.demoSpeed,
      density: DEFAULT_SETTINGS.density,
      serverUrl: DEFAULT_SETTINGS.serverUrl,
      token: DEFAULT_SETTINGS.token,
    });
    setConfirmingReset(false);
  };

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="settings-drawer"
      onKeyDown={handleKeyDown}
      className={cn(
        'fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-hairline bg-surface-1/95 text-ink-1 shadow-2xl backdrop-blur-xl',
        className,
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-[var(--spacing-panel)] py-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-heading font-semibold tracking-tight text-ink-1">
            Settings
          </h2>
          <p className="mt-0.5 text-caption text-ink-3">
            Appearance, motion and the hub connection. Saved in this browser.
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close settings"
          onClick={() => onClose?.()}
          className="rounded-md border border-hairline-strong p-1 text-ink-3 transition-colors motion-safe-only hover:text-ink-1"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Section title="Appearance" icon={<Palette />}>
          <SegmentedRow
            label="Theme"
            testId="theme-options"
            value={settings.theme}
            options={THEME_OPTIONS}
            onChange={(theme) => change({ theme })}
            hint="System follows your OS; the projector default is dark."
          />
          <SegmentedRow
            label="Density"
            testId="density-options"
            value={settings.density}
            options={DENSITY_OPTIONS}
            onChange={(density) => change({ density })}
            hint="Compact fits more of the flock on a laptop screen."
          />
        </Section>

        <Section title="Motion & sound" icon={<Waves />}>
          <SegmentedRow
            label="Motion"
            testId="motion-options"
            value={settings.motion}
            options={MOTION_OPTIONS}
            onChange={(motion) => change({ motion })}
            hint="System respects prefers-reduced-motion. Reduced stills every animation."
          />
          <SwitchRow
            label="Soundscape"
            hint="Chirps when a flock lands on the wire."
            checked={settings.sound}
            onChange={(sound) => change({ sound })}
          />
        </Section>

        <Section title="Demo" icon={<Timer />}>
          <SegmentedRow
            label="Playback speed"
            testId="speed-options"
            value={settings.demoSpeed}
            options={SPEED_OPTIONS}
            onChange={(demoSpeed) => change({ demoSpeed })}
            hint="Used the next time the recorded run starts."
          />
        </Section>

        <Section title="Connection" icon={<Plug />}>
          <ConnectionSection settings={settings} onChange={change} fetchImpl={fetchImpl} />
        </Section>
      </div>

      <footer className="shrink-0 border-t border-hairline px-[var(--spacing-panel)] py-2.5">
        {confirmingReset ? (
          <div className="flex flex-col gap-2">
            <p className="text-caption text-ink-2">Reset every setting to its default?</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-caption font-medium text-amber-100"
              >
                Yes, reset
              </button>
              <button
                type="button"
                onClick={() => setConfirmingReset(false)}
                className="rounded-lg border border-hairline-strong px-2.5 py-1 text-caption text-ink-2 hover:text-ink-1"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingReset(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline-strong px-2.5 py-1 text-caption text-ink-3 transition-colors motion-safe-only hover:text-ink-1"
          >
            <RotateCcw aria-hidden="true" className="h-3 w-3" />
            Reset to defaults
          </button>
        )}
      </footer>
    </aside>
  );
}
