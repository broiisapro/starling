import type { StarlingEvent } from '@starling/core';
import { Bird, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { deriveNodes, deriveTasks } from './derive-nodes';
import { FlockPanel } from './FlockPanel';
import type { JoinInfo } from './handshake';

/** Demo join details for the fixture run; the real ones arrive from `GET /api/flock/join` at C1. */
export const PLAYGROUND_JOIN: JoinInfo = {
  code: 'STAR-LING',
  hubUrl: 'http://192.168.1.42:7777',
  command: 'starling perch --hub http://192.168.1.42:7777 --code STAR-LING',
};

/** The recorded launch-day run is loaded lazily through `fixture-log.ts` (see that file for why). */

export interface ParsedEventLog {
  events: StarlingEvent[];
  /** Lines that were not valid JSON; surfaced in the playground instead of being dropped quietly. */
  skipped: number;
}

/**
 * Parse an event-log JSONL. Structural validation belongs to the store (E00 validates the fixture),
 * so this only rejects lines that are not JSON objects with a string `type` and reports the count.
 */
export function parseEventLog(jsonl: string): ParsedEventLog {
  const events: StarlingEvent[] = [];
  let skipped = 0;
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const value: unknown = JSON.parse(trimmed);
      if (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { type?: unknown }).type === 'string'
      ) {
        events.push(value as StarlingEvent);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  return { events, skipped };
}

function clockLabel(ts: number): string {
  return `${new Date(ts).toISOString().slice(11, 19)}Z`;
}

export interface PlaygroundProps {
  /** Explicit events (tests, Storybook-style demos). When absent the fixture JSONL is loaded. */
  events?: StarlingEvent[];
  /** Play the log automatically on mount. Off by default so the page is quiet until asked. */
  autoplay?: boolean;
  /** Playback rate in events per second. */
  speed?: number;
  reducedMotion?: boolean;
  /** Raw JSONL, used by tests and anyone who wants to drop in another recording. */
  fixture?: string;
}

/**
 * `Playground` — the flock panel driven by the recorded run instead of a live store.
 *
 * Two reasons it exists: it proves the panel renders the Air joining mid-run and dropping without a
 * backend, and it gives the C1 shell a reference for deriving roosts from `node.*` events. It is a
 * dev surface, not part of the dashboard shell, so it is intentionally not wired into `App.tsx`.
 */
export function Playground({
  events: providedEvents,
  autoplay = false,
  speed = 8,
  reducedMotion: reducedMotionProp = false,
  fixture,
}: PlaygroundProps) {
  const [events, setEvents] = useState<readonly StarlingEvent[]>(() => providedEvents ?? []);
  const [revealed, setRevealed] = useState(() => providedEvents?.length ?? 0);
  const [playing, setPlaying] = useState(autoplay);
  const [reducedMotion, setReducedMotion] = useState(reducedMotionProp);
  const [skipped, setSkipped] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // Explicit events win and are read once at mount: a parent that rebuilds the array on every
    // render must not reset the playhead. The fixture props are initial inputs for the same reason.
    if (providedEvents) return;
    if (fixture !== undefined) {
      const parsed = parseEventLog(fixture);
      setEvents(parsed.events);
      setSkipped(parsed.skipped);
      setRevealed(0);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    void import('./fixture-log')
      .then((module) => {
        if (cancelled) return;
        const parsed = parseEventLog(module.LAUNCH_DAY_JSONL);
        setEvents(parsed.events);
        setSkipped(parsed.skipped);
        setRevealed(0);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'could not load the fixture');
      });
    return () => {
      cancelled = true;
    };
  }, [providedEvents, fixture]);

  useEffect(() => {
    if (!playing) return;
    if (revealed >= events.length) {
      setPlaying(false);
      return;
    }
    const delay = Math.max(24, Math.round(1_000 / Math.max(speed, 0.5)));
    const timer = setTimeout(() => setRevealed((current) => Math.min(current + 1, events.length)), delay);
    return () => clearTimeout(timer);
  }, [playing, revealed, events.length, speed]);

  const revealedEvents = useMemo(() => events.slice(0, revealed), [events, revealed]);
  const nodes = useMemo(() => deriveNodes(revealedEvents), [revealedEvents]);
  const tasks = useMemo(() => deriveTasks(revealedEvents), [revealedEvents]);
  const lastEvent = revealedEvents[revealedEvents.length - 1];
  const now = lastEvent ? lastEvent.ts : Date.now();
  const air = nodes.find((node) => node.id !== 'hub');

  const stepToNextRoost = () => {
    setPlaying(false);
    const next = events.findIndex((event, index) => index >= revealed && event.type.startsWith('node.'));
    setRevealed(next === -1 ? events.length : next + 1);
  };

  return (
    <div
      data-testid="flock-playground"
      className="space-y-3 rounded-2xl border border-white/10 bg-slate-950 p-4 text-slate-100"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-300/80">playground</p>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-50">
            <Bird aria-hidden="true" className="h-4 w-4 text-sky-300" />A second roost joins, then closes its
            lid
          </h2>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Replay of{' '}
            <code className="font-mono text-slate-300">fixtures/runs/sky-todo-launch-day.jsonl</code>, derived
            from <code className="font-mono text-slate-300">node.*</code> events.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="playground-toggle"
            onClick={() => setPlaying((value) => !value)}
            disabled={events.length === 0 || revealed >= events.length}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition-colors hover:border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {playing ? (
              <Pause aria-hidden="true" className="h-3 w-3" />
            ) : (
              <Play aria-hidden="true" className="h-3 w-3" />
            )}
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            data-testid="playground-next-roost"
            onClick={stepToNextRoost}
            disabled={events.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-400/10 px-2.5 py-1.5 text-[11px] font-medium text-sky-100 transition-colors hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SkipForward aria-hidden="true" className="h-3 w-3" />
            Next roost event
          </button>
          <button
            type="button"
            data-testid="playground-restart"
            onClick={() => {
              setRevealed(0);
              setPlaying(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition-colors hover:border-white/25 hover:bg-white/10"
          >
            <RotateCcw aria-hidden="true" className="h-3 w-3" />
            Restart
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-[12rem] flex-1 items-center gap-2 text-[10px] text-slate-400">
          <span className="sr-only">Event position</span>
          <input
            data-testid="playground-scrub"
            type="range"
            min={0}
            max={events.length}
            value={Math.min(revealed, events.length)}
            onChange={(event) => {
              setRevealed(Number(event.target.value));
              setPlaying(false);
            }}
            className="h-1 w-full accent-sky-400"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <input
            data-testid="playground-reduced-motion"
            type="checkbox"
            checked={reducedMotion}
            onChange={(event) => setReducedMotion(event.target.checked)}
            className="accent-sky-400"
          />
          reduced motion
        </label>
        <span data-testid="playground-clock" className="font-mono text-[10px] tabular-nums text-slate-400">
          {revealed}/{events.length} events
          {lastEvent ? ` · ${clockLabel(now)}` : ''}
        </span>
        <span data-testid="playground-air" className="text-[10px] text-slate-400">
          {air ? `${air.name}: ${air.status}` : 'no perch yet'}
        </span>
      </div>

      {loadError ? (
        <p
          data-testid="playground-error"
          className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-2.5 py-1.5 text-[11px] text-rose-200"
        >
          Could not load the fixture: {loadError}
        </p>
      ) : null}
      {skipped > 0 ? (
        <p
          data-testid="playground-skipped"
          className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1.5 text-[11px] text-amber-200"
        >
          Skipped {skipped} malformed event {skipped === 1 ? 'line' : 'lines'} in the log.
        </p>
      ) : null}

      <FlockPanel
        nodes={nodes}
        join={PLAYGROUND_JOIN}
        tasks={tasks}
        now={now}
        reducedMotion={reducedMotion}
      />
    </div>
  );
}
