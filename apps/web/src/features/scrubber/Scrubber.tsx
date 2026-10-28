import { Pause, Play, Rewind, SkipForward } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState, Panel, Tabs } from '../../components';
import { cn } from '../../lib/cn';
import { DEFAULT_DEMO_SPEED, DEMO_SPEEDS, type DemoSpeed } from '../../lib/speed';
import { usePrefersReducedMotion } from '../metrics';
import { createPreviewCache } from './derive';
import {
  buildMarkers,
  clampIndex,
  filterMarkers,
  MARKER_FILTERS,
  type MarkerFilter,
  markerCounts,
  nextFailure,
} from './markers';
import { PreviewCard } from './PreviewCard';
import { MARKER_ICON, MARKER_STYLE } from './palette';
import { ScrubberTrack } from './ScrubberTrack';
import type { ScrubberProps } from './types';

const FILTER_META: Record<MarkerFilter, { label: string; kinds: string }> = {
  merges: { label: 'merges', kinds: 'Merged tasks and conflicts' },
  failures: { label: 'failures', kinds: 'Failed audits, failed tasks and conflicts' },
  nodes: { label: 'nodes', kinds: 'Perches joining, leaving and tasks migrating' },
};

/**
 * The replay scrubber.
 *
 * Two modes, chosen by whether the shell can seek:
 * - **controlled** (`onSeek` supplied): the head is `props.index`; every gesture is a seek request.
 * - **preview** (no `onSeek`): the component owns its head and renders a preview card computed by
 *   replaying the first `index + 1` events through the store's own reducer. The live panes keep
 *   playing, hence the label.
 *
 * Positions are proportional to time (see `markers.ts`), so the Air's quiet minute is a visible gap.
 * Marker clusters collapse below 4 px; all 5 000 events of a long live run stay on one track without
 * turning into a smear.
 */
export function Scrubber({
  state,
  events: eventsProp,
  index: indexProp,
  playing: playingProp,
  speed: speedProp,
  onSeek,
  onPlayPause,
  onSpeedChange,
}: ScrubberProps) {
  const events = eventsProp ?? state.events;
  const controlled = onSeek !== undefined;
  const last = Math.max(0, events.length - 1);

  const [localIndex, setLocalIndex] = useState(() => clampIndex(indexProp ?? last, events.length));
  const [syncedProp, setSyncedProp] = useState(indexProp);
  const [localPlaying, setLocalPlaying] = useState(playingProp ?? false);
  const [localSpeed, setLocalSpeed] = useState<DemoSpeed>(speedProp ?? DEFAULT_DEMO_SPEED);
  const [filters, setFilters] = useState<readonly MarkerFilter[]>(MARKER_FILTERS);

  // An explicitly supplied index wins once; a local seek is not undone by the next render. If the
  // parent changes the prop, the component follows it.
  useEffect(() => {
    if (indexProp !== undefined && indexProp !== syncedProp) {
      setSyncedProp(indexProp);
      setLocalIndex(clampIndex(indexProp, events.length));
    }
  }, [indexProp, syncedProp, events.length]);

  // A growing log (the live store) must never leave the head past the end.
  useEffect(() => {
    setLocalIndex((current) => Math.min(current, last));
  }, [last]);

  const index = controlled ? clampIndex(indexProp ?? last, events.length) : localIndex;
  const playing = playingProp ?? localPlaying;
  const speed = speedProp ?? localSpeed;
  const reducedMotion = usePrefersReducedMotion();

  const markers = useMemo(() => buildMarkers(events), [events]);
  const visibleMarkers = useMemo(() => filterMarkers(markers, filters), [markers, filters]);
  const counts = useMemo(() => markerCounts(markers), [markers]);
  const previewCache = useMemo(() => createPreviewCache(events), [events]);
  const preview = controlled ? undefined : previewCache(index);
  const failure = nextFailure(markers, index);

  const seek = (next: number): void => {
    const target = clampIndex(next, events.length);
    if (controlled) onSeek?.(target);
    else setLocalIndex(target);
  };

  const toggleFilter = (filter: MarkerFilter): void => {
    setFilters((current) =>
      current.includes(filter) ? current.filter((candidate) => candidate !== filter) : [...current, filter],
    );
  };

  const togglePlay = (): void => {
    const next = !playing;
    if (playingProp === undefined) setLocalPlaying(next);
    onPlayPause?.(next);
  };

  const changeSpeed = (next: DemoSpeed): void => {
    if (speedProp === undefined) setLocalSpeed(next);
    onSpeedChange?.(next);
  };

  const speedTabs = DEMO_SPEEDS.map((value) => ({ id: value, label: `${value}×` }));

  return (
    <Panel
      title="Replay"
      subtitle={
        controlled
          ? 'controlled · seeking the live store'
          : 'preview mode · jump to the moment without waiting'
      }
      className="min-w-0"
      bodyClassName="px-[var(--spacing-panel)] py-3"
      actions={
        <>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause replay' : 'Play replay'}
            aria-pressed={playing}
            data-testid="scrubber-toggle"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink-1"
          >
            {playing ? (
              <Pause aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <Play aria-hidden="true" className="h-3.5 w-3.5" />
            )}
          </button>
          <Tabs tabs={speedTabs} value={speed} onChange={changeSpeed} ariaLabel="Replay speed" />
        </>
      }
    >
      {events.length === 0 ? (
        <EmptyState
          compact
          icon={<Rewind aria-hidden="true" />}
          title="Nothing to scrub yet"
          description="A recording appears here as soon as the flock has a run to replay."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ScrubberTrack
            events={events}
            index={index}
            markers={visibleMarkers}
            reducedMotion={reducedMotion}
            onSeek={seek}
            onPlayPause={togglePlay}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <fieldset className="flex flex-wrap items-center gap-1 border-0 p-0">
              <legend className="sr-only">Marker filters</legend>
              {MARKER_FILTERS.map((filter) => {
                const active = filters.includes(filter);
                const meta = FILTER_META[filter];
                return (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={active}
                    aria-label={`${active ? 'Hide' : 'Show'} ${meta.label}`}
                    title={meta.kinds}
                    data-testid={`scrubber-filter-${filter}`}
                    onClick={() => toggleFilter(filter)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-medium capitalize',
                      active
                        ? 'border-hairline-strong bg-surface-3 text-ink-2'
                        : 'border-hairline bg-transparent text-ink-4',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-teal-300' : 'bg-ink-4')}
                    />
                    {meta.label}
                    <span className="font-mono tabular-nums text-ink-4">{counts[filter]}</span>
                  </button>
                );
              })}
            </fieldset>

            <button
              type="button"
              onClick={() => failure !== undefined && seek(failure.index)}
              disabled={failure === undefined}
              aria-label="Jump to next failure"
              title={failure === undefined ? 'No failure after the head' : `Jump to ${failure.label}`}
              data-testid="scrubber-failure"
              className="inline-flex items-center gap-1 rounded-md border border-red-400/30 bg-red-400/10 px-2 py-1 text-micro font-medium text-red-200 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-ink-4"
            >
              <SkipForward aria-hidden="true" className="h-3 w-3" />
              next failure
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-micro text-ink-4">
            {(['merge', 'fail', 'node-join', 'migrate', 'plan', 'finish'] as const).map((kind) => {
              const Icon = MARKER_ICON[kind];
              return (
                <span key={kind} className="inline-flex items-center gap-1">
                  <Icon aria-hidden="true" className={cn('h-3 w-3', MARKER_STYLE[kind].text)} />
                  {MARKER_STYLE[kind].name}
                </span>
              );
            })}
          </div>

          {controlled ? null : <PreviewCard preview={preview} />}
        </div>
      )}
    </Panel>
  );
}
