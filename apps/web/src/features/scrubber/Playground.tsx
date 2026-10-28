import type { StarlingEvent } from '@starling/core/browser';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Panel } from '../../components';
import { demoEvents } from '../../data/demo';
import { applyEvents, createInitialState } from '../../data/reducer';
import { formatTokens, formatUsd } from '../../lib/format';
import { DEFAULT_DEMO_SPEED, type DemoSpeed } from '../../lib/speed';
import { STATUS_COLORS } from '../../lib/status';
import { previewAt } from './derive';
import { Scrubber } from './Scrubber';

/**
 * Vite-only playground: a **fully controlled** scrubber over the recorded launch-day run.
 *
 * The page owns `index`, `playing` and `speed`, re-derives a `SkyState` from the fixture at the head
 * and renders the summary beside the track — exactly the wiring C3 will do once Epic 204 adds
 * `seek(index)` to the store. Because the head is real here, this is the place to check that seeking
 * shows the right moment: drag to the Air's lid closing and watch `search` migrate.
 */
export default function Playground() {
  const events = useMemo<readonly StarlingEvent[]>(() => demoEvents(), []);
  const last = Math.max(0, events.length - 1);
  const [index, setIndex] = useState(() => Math.max(0, Math.floor(last * 0.6)));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<DemoSpeed>(DEFAULT_DEMO_SPEED);

  // A deliberately simple event-per-tick player. The real store's demo player owns timing in the
  // shell; here it only has to make the controlled wiring visibly move.
  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(
      () => {
        setIndex((current) => Math.min(last, current + 1));
      },
      Math.max(16, 320 / speed),
    );
    return () => clearTimeout(timer);
  }, [playing, index, last, speed]);

  const preview = previewAt(events, index);
  const state = useMemo(() => applyEvents(createInitialState(), events.slice(0, index + 1)), [events, index]);
  const run = state.activeRunId === undefined ? undefined : state.runs[state.activeRunId];
  const tasks = run === undefined ? [] : Object.values(run.tasks);

  return (
    <main className="min-h-screen bg-surface-0 p-6 text-ink-1">
      <header className="mb-4">
        <p className="text-micro font-semibold uppercase tracking-[0.2em] text-teal-300">
          Starling · scrubber playground
        </p>
        <h1 className="mt-1 text-title font-semibold">Replay the launch-day run, backwards and forwards</h1>
        <p className="mt-1 max-w-2xl text-caption text-ink-3">
          The scrubber below is controlled: it asks this page to move, the page re-derives the run at that
          event and the summary updates. Shift+←/→ jumps markers, PageUp/PageDown moves ten seconds, and the
          dotted card is the preview the shell shows while Epic 204's store seek is not wired yet.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Scrubber
          state={state}
          events={events}
          index={index}
          playing={playing}
          speed={speed}
          onSeek={setIndex}
          onPlayPause={setPlaying}
          onSpeedChange={setSpeed}
        />

        <Panel title="At this event" subtitle={`index ${index + 1} / ${events.length}`}>
          <div className="flex flex-col gap-3 px-3 py-3">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="success">
                landed {preview?.landed ?? 0}/{preview?.tasks ?? 0}
              </Badge>
              <Badge tone="accent">flying {preview?.flying ?? 0}</Badge>
              <Badge tone={(preview?.failed ?? 0) > 0 ? 'danger' : 'neutral'}>
                failed {preview?.failed ?? 0}
              </Badge>
            </div>
            <p className="text-caption text-ink-3">
              {formatUsd(preview?.costUsd ?? 0)} · {formatTokens(preview?.tokens ?? 0)} tok
            </p>
            <p className="truncate font-mono text-caption text-ink-3">
              {preview?.lastEvent?.type ?? '—'} · {preview?.lastEvent?.summary ?? 'nothing yet'}
            </p>

            <ul className="flex flex-col gap-1" aria-label="Task statuses at the head">
              {tasks.length === 0 ? (
                <li className="text-caption text-ink-4">No tasks at this point.</li>
              ) : (
                tasks.map((task) => {
                  const palette = STATUS_COLORS[task.status];
                  return (
                    <li key={task.taskKey} className="flex items-center justify-between gap-2 text-caption">
                      <span className="truncate font-mono text-ink-2">{task.taskKey}</span>
                      <span className={palette.text}>{palette.label}</span>
                    </li>
                  );
                })
              )}
            </ul>

            <label className="flex flex-col gap-1 text-micro text-ink-4">
              raw event index
              <input
                type="range"
                min={0}
                max={last}
                value={index}
                aria-label="Raw event index"
                onChange={(event) => setIndex(Number(event.target.value))}
                className="accent-teal-400"
              />
            </label>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPlaying((current) => !current)}
                aria-pressed={playing}
                className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface-2 px-2 py-1 text-micro text-ink-2"
              >
                {playing ? (
                  <Pause aria-hidden="true" className="h-3 w-3" />
                ) : (
                  <Play aria-hidden="true" className="h-3 w-3" />
                )}
                {playing ? 'pause' : 'play'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setIndex(0);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface-2 px-2 py-1 text-micro text-ink-2"
              >
                <RotateCcw aria-hidden="true" className="h-3 w-3" />
                rewind
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </main>
  );
}
