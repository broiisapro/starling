import { useMemo, useState } from 'react';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState } from '../../data/reducer';
import { readTheme, toggleTheme } from '../../lib/theme';
import { CommandPalette } from './CommandPalette';
import type { PaletteCommand, PaletteFeature } from './items';
import { writeRecent } from './recent';

/**
 * Dev playground for ⌘K. Vite only: `/src/features/palette/playground.html`.
 *
 * The 15 entries mirror the Wave 3 assignments in L39 (ids, titles and hotkeys), so the list looks
 * exactly like what the shell's registry will pass at C3. Everything is fixture-driven: no hub, no
 * network, no real agents.
 */
const WAVE_3_FEATURES: readonly PaletteFeature[] = [
  {
    id: 'report',
    title: 'Run report',
    description: 'What happened, in prose',
    kind: 'view',
    icon: 'BarChart3',
    hotkey: 'r',
  },
  {
    id: 'timeline',
    title: 'Timeline',
    description: 'Every event, in order',
    kind: 'view',
    icon: 'Clock',
    hotkey: 't',
  },
  {
    id: 'lanes',
    title: 'Lane map',
    description: 'Who owns which files',
    kind: 'view',
    icon: 'Layers',
    hotkey: 'l',
  },
  {
    id: 'costs',
    title: 'Costs',
    description: 'API vs local spend',
    kind: 'panel',
    icon: 'Coins',
    hotkey: 'c',
  },
  {
    id: 'console',
    title: 'Console',
    description: 'Raw event stream',
    kind: 'panel',
    icon: 'Terminal',
    hotkey: '`',
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Theme, demo speed, motion',
    kind: 'overlay',
    icon: 'Settings',
    hotkey: ',',
  },
  {
    id: 'palette',
    title: 'Command palette',
    description: 'This dialog — the fastest way around',
    kind: 'overlay',
    icon: 'Command',
    hotkey: 'mod+k',
  },
  {
    id: 'compare',
    title: 'Compare runs',
    description: 'Two runs, side by side',
    kind: 'page',
    icon: 'GitCompare',
    hotkey: 'x',
  },
  {
    id: 'export',
    title: 'Export run',
    description: 'Download the JSONL recording',
    kind: 'overlay',
    icon: 'Download',
    hotkey: 'e',
  },
  {
    id: 'scrubber',
    title: 'Time scrubber',
    description: 'Scrub the event timeline',
    kind: 'panel',
    icon: 'Crosshair',
    hotkey: '.',
  },
  {
    id: 'heatmap',
    title: 'Activity heatmap',
    description: 'Task activity per minute',
    kind: 'view',
    icon: 'Grid3x3',
    hotkey: 'h',
  },
  {
    id: 'leaderboard',
    title: 'Leaderboard',
    description: 'Which roost flies fastest',
    kind: 'view',
    icon: 'Trophy',
    hotkey: 'L',
  },
  {
    id: 'stage',
    title: 'Stage mode',
    description: 'Big, quiet, presentation-ready',
    kind: 'overlay',
    icon: 'Sparkles',
    hotkey: 's',
  },
  {
    id: 'topology',
    title: 'Flock topology',
    description: 'Hub, perches and their wires',
    kind: 'view',
    icon: 'Network',
    hotkey: 'o',
  },
  {
    id: 'health',
    title: 'Health',
    description: 'Doctor checks at a glance',
    kind: 'panel',
    icon: 'HeartPulse',
    hotkey: '!',
  },
];

export default function Playground() {
  const events = useMemo(() => demoEvents(), []);
  const [index, setIndex] = useState(events.length);
  const [openCount, setOpenCount] = useState(1);
  const [paletteKey, setPaletteKey] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  const state = useMemo(() => applyEvents(createInitialState(), events.slice(0, index)), [events, index]);

  const record = (entry: string): void => {
    setLog((previous) => [entry, ...previous].slice(0, 24));
  };

  const commands: readonly PaletteCommand[] = [
    {
      id: 'toggle-theme',
      label: 'Toggle light or dark theme',
      hint: 'The dashboard is dark by default',
      run: () => {
        const next = toggleTheme(readTheme());
        record(`command → toggle theme (${next})`);
      },
    },
    {
      id: 'demo-speed',
      label: 'Set demo speed to 4×',
      hint: 'Playback speed for the recorded run',
      run: () => record('command → demo speed 4×'),
    },
    {
      id: 'clear-recent',
      label: 'Clear recent picks',
      hint: 'Forgets the last eight choices',
      run: () => {
        writeRecent([]);
        setPaletteKey((value) => value + 1);
        record('command → cleared recents');
      },
    },
  ];

  const close = (): void => {
    setOpenCount(0);
    record('closed');
  };

  const finished = index === events.length;
  const taskCount = Object.keys(state.runs[state.activeRunId ?? '']?.tasks ?? {}).length;

  return (
    <main className="min-h-screen bg-surface-0 p-6 text-ink-1">
      <header className="mb-4">
        <p className="text-micro font-semibold uppercase tracking-[0.2em] text-irid-teal">
          Starling · Command palette playground
        </p>
        <h1 className="mt-1 text-title font-semibold">⌘K over the recorded launch-day run</h1>
        <p className="mt-1 max-w-2xl text-body text-ink-2">
          {state.activeRunId === undefined
            ? 'Scrub forward to load a run.'
            : `Run ${state.activeRunId.slice(-6)} · ${taskCount} tasks · ${
                finished ? 'finished' : `event ${index} of ${events.length}`
              }`}
        </p>
      </header>

      <section className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-hairline bg-panel p-3 text-caption text-ink-2">
        <label className="flex flex-1 items-center gap-2">
          <span className="whitespace-nowrap text-ink-3">Event</span>
          <input
            type="range"
            min={0}
            max={events.length}
            value={index}
            onChange={(event) => setIndex(Number(event.target.value))}
            className="w-full accent-[var(--color-irid-teal)]"
          />
          <span className="w-16 text-right font-mono text-ink-3">
            {index}/{events.length}
          </span>
        </label>
        <button
          type="button"
          onClick={() => setOpenCount((value) => value + 1)}
          className="rounded-lg border border-irid-teal/40 bg-irid-teal/15 px-3 py-1.5 text-body font-medium text-ink-1 hover:bg-irid-teal/25"
        >
          Open palette
        </button>
        <span className="text-ink-4">⌘K / Ctrl-K is bound by the shell, not this page.</span>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="rounded-[var(--radius-panel)] border border-hairline bg-panel p-4">
          <h2 className="text-heading font-semibold">The 15 Wave 3 views</h2>
          <p className="mt-1 text-caption text-ink-3">
            Passed to the palette exactly as the shell will pass registry manifests at C3.
          </p>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {WAVE_3_FEATURES.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-hairline px-2.5 py-1.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-body text-ink-1">{entry.title}</span>
                  <span className="block truncate text-micro text-ink-4">
                    {entry.id} · {entry.kind}
                  </span>
                </span>
                <kbd className="rounded border border-hairline-strong px-1.5 font-mono text-micro text-ink-3">
                  {entry.hotkey ?? '—'}
                </kbd>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[var(--radius-panel)] border border-hairline bg-panel p-4">
          <h2 className="text-heading font-semibold">Picked</h2>
          <p className="mt-1 text-caption text-ink-3">
            What the palette called. Every pick also lands in `starling.palette.recent.v1`.
          </p>
          {log.length === 0 ? (
            <p className="mt-3 text-caption text-ink-4">Nothing picked yet.</p>
          ) : (
            <ol className="mt-3 space-y-1 text-caption text-ink-2">
              {log.map((entry, position) => (
                // A playground log has no ids; the index is stable enough for a dev-only list.
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only debug log
                <li key={`${position}-${entry}`} className="truncate font-mono text-micro">
                  {entry}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      {openCount > 0 ? (
        <CommandPalette
          key={`${paletteKey}-${openCount}`}
          state={state}
          features={WAVE_3_FEATURES}
          commands={commands}
          onSelectTask={(key) => record(`task → ${key}`)}
          onSelectRun={(runId) => record(`run → ${runId}`)}
          onOpenFeature={(id) => record(`feature → ${id}`)}
          onClose={close}
        />
      ) : null}
    </main>
  );
}
