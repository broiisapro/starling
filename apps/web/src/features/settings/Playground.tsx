import { useMemo, useState } from 'react';
import { Badge } from '../../components';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState } from '../../data/reducer';
import { activeRunOf } from '../../data/selectors';
import { statusLabel } from '../../lib/status';
import { readSettings, type StarlingSettings } from '.';
import { SettingsDrawer } from './SettingsDrawer';

/**
 * Dev playground for the settings drawer: `?playground=settings` (wired at C3) or Vite
 * `/src/features/settings/playground.html`.
 *
 * A recorded run provides a backdrop so the drawer's translucency and light/dark tokens can be judged
 * against real content. The JSON block below it is the stored value, updated live as you change
 * anything — including the token, which is shown here only because this page is a dev tool.
 */
export default function Playground() {
  const events = useMemo(() => demoEvents(), []);
  const [sliceEnd, setSliceEnd] = useState(events.length);
  const state = useMemo(
    () => applyEvents(createInitialState(), events.slice(0, sliceEnd)),
    [events, sliceEnd],
  );
  const run = activeRunOf(state);
  const [stored, setStored] = useState<StarlingSettings>(() => readSettings());
  const [open, setOpen] = useState(true);

  const tasks = run?.plan?.tasks ?? [];
  const merged = Object.values(run?.tasks ?? {}).filter((task) => task.status === 'merged').length;

  return (
    <main className="min-h-screen bg-surface-0 p-6 pr-6 text-ink-1 md:pr-[460px]">
      <header className="mb-4">
        <p className="text-micro font-semibold tracking-[0.2em] text-teal-300 uppercase">
          Starling · Settings playground
        </p>
        <h1 className="mt-1 text-title font-semibold tracking-tight">One drawer, every knob</h1>
        <p className="mt-1 max-w-2xl text-caption text-ink-3">
          Backdrop: {events.length} recorded launch-day events, {sliceEnd} applied. Open the drawer with the
          button or the <code className="font-mono text-ink-2">,</code> key once the shell binds it. Changes
          persist to <code className="font-mono text-ink-2">starling.settings.v1</code> and apply to{' '}
          <code className="font-mono text-ink-2">&lt;html&gt;</code> immediately.
        </p>
      </header>

      <section
        aria-label="Sample run"
        className="rounded-[var(--radius-panel)] border border-hairline bg-panel p-[var(--spacing-panel)] backdrop-blur-md"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{run?.status ?? 'no run'}</Badge>
          <span className="font-mono text-caption text-ink-3">{run?.id ?? '—'}</span>
          <span className="text-caption text-ink-2">
            {merged}/{tasks.length} tasks merged
          </span>
        </div>
        <h2 className="mt-2 text-heading font-semibold">{run?.goal.text ?? 'No run in this slice'}</h2>
        <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {tasks.map((task) => {
            const status = run?.tasks[task.key]?.status ?? 'pending';
            return (
              <li
                key={task.key}
                className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-surface-1/60 px-2.5 py-1.5"
              >
                <span className="truncate text-caption text-ink-2">{task.title}</span>
                <span className="shrink-0 font-mono text-micro text-ink-3">{statusLabel(status)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-label="Playback controls"
        className="mt-4 rounded-[var(--radius-panel)] border border-hairline bg-surface-1/70 p-[var(--spacing-panel)]"
      >
        <label htmlFor="settings-slice" className="text-caption text-ink-2">
          Event slice — {sliceEnd} / {events.length}
        </label>
        <input
          id="settings-slice"
          type="range"
          min={0}
          max={events.length}
          step={1}
          value={sliceEnd}
          onChange={(event) => setSliceEnd(Number(event.target.value))}
          className="mt-2 w-full accent-teal-400"
        />
      </section>

      <section
        aria-label="Stored settings"
        className="mt-4 rounded-[var(--radius-panel)] border border-hairline bg-surface-1/70 p-[var(--spacing-panel)]"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-heading font-semibold">Stored value</h2>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-hairline-strong px-2.5 py-1 text-caption text-ink-2 hover:text-ink-1"
          >
            Open settings
          </button>
        </div>
        <pre
          data-testid="stored-settings"
          className="max-h-72 overflow-auto rounded-lg bg-surface-0/70 p-3 font-mono text-micro text-ink-2"
        >
          {JSON.stringify(stored, null, 2)}
        </pre>
      </section>

      {open ? (
        <SettingsDrawer onClose={() => setOpen(false)} onSettingsChange={(next) => setStored(next)} />
      ) : null}
    </main>
  );
}
