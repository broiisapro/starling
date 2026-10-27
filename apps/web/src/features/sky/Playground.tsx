import type { StarlingEvent } from '@starling/core';
import type { ChangeEvent, CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { statusColor, TASK_STATUSES } from './palette';
import { buildFrame, indexAtTs, nextBeat, parseEventJsonl, statusCounts } from './replay';
import { SkyView } from './SkyView';

/**
 * A self-contained dev page for the Sky. It drives `SkyView` from a recorded JSONL event stream with
 * a scrubber, play/pause and beat stepping — no global store, no server, no SSE.
 *
 * Two ways in:
 * - `<Playground events={parseEventJsonl(text)} />` — the bundled fixture (`preview.tsx` does this,
 *   so the demo works even if the API is down),
 * - `<Playground src="/fixtures/runs/sky-todo-launch-day.jsonl" />` — fetch at runtime, or drop a
 *   JSONL file on the page if the fixture is not being served.
 */
export interface PlaygroundProps {
  events?: readonly StarlingEvent[];
  src?: string;
  initialIndex?: number;
  autoPlay?: boolean;
  /** Start with the calm (reduced-motion) layout, for screenshots and accessibility checks. */
  initialCalm?: boolean;
}

export const DEFAULT_FIXTURE_URL = '/fixtures/runs/sky-todo-launch-day.jsonl';

export function Playground({
  events,
  src,
  initialIndex = 0,
  autoPlay = false,
  initialCalm = false,
}: PlaygroundProps) {
  const [loaded, setLoaded] = useState<StarlingEvent[] | null>(events ? [...events] : null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(initialIndex);
  const [playing, setPlaying] = useState(autoPlay);
  const [speed, setSpeed] = useState(4);
  const [calm, setCalm] = useState(initialCalm);
  const [selected, setSelected] = useState<string | undefined>();
  // Remounting SkyView on a manual scrub resets the sim, so scrubbing backwards is exact.
  const [epoch, setEpoch] = useState(0);
  const playheadRef = useRef(0);
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    if (events) {
      setLoaded([...events]);
      setError(null);
      setIndex(Math.max(0, Math.min(events.length - 1, initialIndex)));
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(src ?? DEFAULT_FIXTURE_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = parseEventJsonl(await response.text());
        if (cancelled) return;
        setLoaded(parsed);
        setError(parsed.length === 0 ? 'That file had no valid Starling events.' : null);
        setIndex(Math.max(0, Math.min(parsed.length - 1, initialIndex)));
      } catch {
        if (cancelled) return;
        setLoaded([]);
        setError(`Could not fetch ${src ?? DEFAULT_FIXTURE_URL}. Choose the fixture JSONL below.`);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [events, src, initialIndex]);

  const list = useMemo(() => loaded ?? [], [loaded]);
  const frame = useMemo(() => buildFrame(list, index), [list, index]);
  const counts = useMemo(() => statusCounts(frame.run), [frame.run]);
  const firstTs = list[0]?.ts ?? frame.ts;
  const offsetSeconds = Math.max(0, Math.round((frame.ts - firstTs) / 1000));

  const scrub = useCallback(
    (next: number) => {
      setPlaying(false);
      setIndex(Math.max(0, Math.min(list.length - 1, next)));
      setEpoch((value) => value + 1);
      playheadRef.current = list[next]?.ts ?? 0;
    },
    [list],
  );

  const stepBeat = useCallback(
    (direction: 1 | -1) => {
      scrub(nextBeat(list, indexRef.current, direction));
    },
    [scrub, list],
  );

  const togglePlay = useCallback(() => {
    setPlaying((value) => {
      if (!value && indexRef.current >= list.length - 1) {
        setIndex(0);
        playheadRef.current = list[0]?.ts ?? 0;
      }
      return !value;
    });
  }, [list]);

  // Playhead: advance wall time by `speed`, map it back to an event index.
  useEffect(() => {
    if (!playing || list.length === 0) return;
    playheadRef.current = list[indexRef.current]?.ts ?? list[0]?.ts ?? 0;
    let raf = 0;
    let last = performance.now();
    const endTs = list[list.length - 1]?.ts ?? 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      playheadRef.current += dt * 1000 * speed;
      if (playheadRef.current >= endTs) {
        setIndex(list.length - 1);
        setPlaying(false);
        return;
      }
      const next = indexAtTs(list, playheadRef.current);
      setIndex((previous) => (next !== previous ? next : previous));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, list, speed]);

  const onFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const parsed = parseEventJsonl(await file.text());
    setLoaded(parsed);
    setError(parsed.length === 0 ? 'That file had no valid Starling events.' : null);
    setIndex(0);
    setEpoch((value) => value + 1);
    setPlaying(false);
  }, []);

  return (
    <div style={PAGE_STYLE}>
      <header style={HEADER_STYLE}>
        <div>
          <h1 style={TITLE_STYLE}>Sky playground</h1>
          <p style={SUBTITLE_STYLE}>
            fixture · t+{offsetSeconds}s · {list.length} events · frame {frame.index}
          </p>
        </div>
        <div style={BUTTON_ROW}>
          <button type="button" style={BUTTON} onClick={togglePlay} disabled={list.length === 0}>
            {playing ? '❚❚ pause' : '▶ play'}
          </button>
          <button type="button" style={BUTTON} onClick={() => stepBeat(-1)} disabled={list.length === 0}>
            ‹ beat
          </button>
          <button type="button" style={BUTTON} onClick={() => stepBeat(1)} disabled={list.length === 0}>
            beat ›
          </button>
          <button
            type="button"
            style={BUTTON}
            onClick={() => scrub(list.length - 1)}
            disabled={list.length === 0}
          >
            ⏭ end
          </button>
          <label style={CHECKBOX}>
            <input type="checkbox" checked={calm} onChange={(event) => setCalm(event.target.checked)} />
            reduced motion
          </label>
          <label style={CHECKBOX}>
            speed
            <select
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              style={SELECT_STYLE}
            >
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
              <option value={8}>8×</option>
            </select>
          </label>
        </div>
      </header>

      <input
        type="range"
        min={0}
        max={Math.max(0, list.length - 1)}
        value={Math.min(index, Math.max(0, list.length - 1))}
        onChange={(event) => scrub(Number(event.target.value))}
        aria-label="Scrub the recorded run"
        style={RANGE_STYLE}
      />

      <div style={SKY_BOX}>
        {list.length > 0 ? (
          <SkyView
            key={epoch}
            run={frame.run}
            nodes={frame.nodes}
            recent={frame.recent}
            selectedTask={selected}
            onSelectTask={setSelected}
            reducedMotion={calm}
          />
        ) : (
          <div style={EMPTY_STYLE}>No events loaded.</div>
        )}
      </div>

      <footer style={FOOTER_STYLE}>
        <div style={CHIP_ROW}>
          {TASK_STATUSES.filter((status) => counts[status] > 0).map((status) => (
            <span key={status} style={{ ...CHIP, borderColor: statusColor(status) }}>
              <span style={{ ...DOT, background: statusColor(status) }} />
              {status} {counts[status]}
            </span>
          ))}
        </div>
        <div style={CHIP_ROW}>
          {frame.nodes.map((node) => (
            <span key={node.id} style={CHIP}>
              {node.name} · {node.status} · {node.activeSessions}/{node.maxSessions}
            </span>
          ))}
          {selected ? <span style={CHIP}>selected {selected}</span> : null}
        </div>
      </footer>

      {error ? (
        <div style={ERROR_STYLE}>
          <span>{error}</span>
          <label style={BUTTON}>
            load JSONL
            <input type="file" accept=".jsonl,.json,text/plain" onChange={onFile} style={FILE_INPUT} />
          </label>
        </div>
      ) : null}
    </div>
  );
}

const PAGE_STYLE: CSSProperties = {
  minHeight: '100vh',
  padding: 20,
  background: '#050912',
  color: '#dbe7ff',
  font: '12px ui-monospace, SFMono-Regular, Menlo, monospace',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  boxSizing: 'border-box',
};

const HEADER_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: 12,
};

const TITLE_STYLE: CSSProperties = { margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: 0.3 };
const SUBTITLE_STYLE: CSSProperties = { margin: '4px 0 0', color: '#8fa2b8' };
const BUTTON_ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };

const BUTTON: CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid rgba(160, 196, 255, 0.25)',
  background: 'rgba(18, 28, 50, 0.9)',
  color: '#dbe7ff',
  font: 'inherit',
  cursor: 'pointer',
};

const CHECKBOX: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', color: '#a8bcd8' };

const SELECT_STYLE: CSSProperties = {
  background: '#0d1526',
  color: '#dbe7ff',
  border: '1px solid rgba(160, 196, 255, 0.25)',
  borderRadius: 4,
  padding: '2px 4px',
  font: 'inherit',
};

const RANGE_STYLE: CSSProperties = { width: '100%', accentColor: '#4fc3ff' };

const SKY_BOX: CSSProperties = {
  height: 'calc(100vh - 230px)',
  minHeight: 320,
  borderRadius: 10,
  overflow: 'hidden',
  border: '1px solid rgba(160, 196, 255, 0.18)',
};

const EMPTY_STYLE: CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  height: '100%',
  color: '#8fa2b8',
};

const FOOTER_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const CHIP_ROW: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
const CHIP: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  borderRadius: 999,
  border: '1px solid rgba(160, 196, 255, 0.18)',
  color: '#a8bcd8',
};
const DOT: CSSProperties = { width: 6, height: 6, borderRadius: 999, display: 'inline-block' };
const ERROR_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 10,
  alignItems: 'center',
  color: '#ffb4a2',
};
const FILE_INPUT: CSSProperties = { display: 'none' };
