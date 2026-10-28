import type { StarlingEvent } from '@starling/core/browser';
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { Tooltip } from '../../components';
import { cn } from '../../lib/cn';
import {
  clampIndex,
  clusterMarkers,
  eventSpan,
  indexAtOffset,
  indexAtTime,
  type Marker,
  markerPositions,
  nextMarker,
  positionOfTime,
  scrubClockLabel,
  scrubValueText,
  timeAtIndex,
} from './markers';
import { MARKER_ICON, MARKER_STYLE } from './palette';

/** Used until a ResizeObserver reports the real width (and in happy-dom, which has no layout). */
const DEFAULT_TRACK_WIDTH = 960;
const MIN_MARKER_GAP_PX = 4;
const PAGE_STEP_MS = 10_000;

export interface ScrubberTrackProps {
  events: readonly StarlingEvent[];
  index: number;
  /** Already filtered by the legend chips. */
  markers: readonly Marker[];
  reducedMotion: boolean;
  onSeek(index: number): void;
  onPlayPause?(): void;
}

function markerLabel(markers: readonly Marker[]): string {
  if (markers.length === 1) return markers[0]?.label ?? 'marker';
  return `${markers.length} moments: ${markers.map((marker) => marker.label).join(' · ')}`;
}

/**
 * The track: rail, progress, clustered markers and the draggable head.
 *
 * Pointer drag coalesces moves into one `onSeek` per animation frame (100 agents on one laptop means
 * a runaway move handler is not free) and always emits one final seek on release so the head can
 * never stop between two events. The head is a real `role="slider"` with keyboard support.
 */
export function ScrubberTrack({
  events,
  index,
  markers,
  reducedMotion,
  onSeek,
  onPlayPause,
}: ScrubberTrackProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const frame = useRef<number | null>(null);
  const pending = useRef<number | null>(null);
  const [width, setWidth] = useState(DEFAULT_TRACK_WIDTH);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const element = trackRef.current;
    if (element === null) return;
    const measure = (): void => {
      const measured = element.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const span = eventSpan(events);
  const last = Math.max(0, events.length - 1);
  const clamped = clampIndex(index, events.length);
  const headPosition = positionOfTime(timeAtIndex(events, clamped), span);
  const clusters = clusterMarkers(markerPositions(markers, span), width, MIN_MARKER_GAP_PX);

  const indexFromPointer = (clientX: number): number => {
    const element = trackRef.current;
    if (element === null || events.length === 0) return clamped;
    const rect = element.getBoundingClientRect();
    return indexAtOffset(events, clientX - rect.left, rect.width > 0 ? rect.width : width);
  };

  const emitNow = (next: number): void => {
    onSeek(clampIndex(next, events.length));
  };

  /** Cancel a scheduled frame and emit whatever is pending, so release is never lossy. */
  const flush = (): void => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const value = pending.current;
    pending.current = null;
    if (value !== null) emitNow(value);
  };

  const schedule = (next: number): void => {
    pending.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const value = pending.current;
      pending.current = null;
      if (value !== null) emitNow(value);
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    dragging.current = true;
    setIsDragging(true);
    headRef.current?.focus();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // happy-dom and older browsers do not implement pointer capture; dragging still works because
      // the handlers live on the track itself.
    }
    schedule(indexFromPointer(event.clientX));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    schedule(indexFromPointer(event.clientX));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // See `onPointerDown`.
    }
    pending.current = indexFromPointer(event.clientX);
    flush();
  };

  const onPointerCancel = (): void => {
    if (!dragging.current) return;
    dragging.current = false;
    setIsDragging(false);
    flush();
  };

  const seek = (next: number): void => {
    const target = clampIndex(next, events.length);
    if (target !== clamped) onSeek(target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const key = event.key;
    if (key === 'ArrowRight') {
      event.preventDefault();
      if (event.shiftKey) {
        const marker = nextMarker(markers, clamped, 1);
        if (marker !== undefined) seek(marker.index);
      } else {
        seek(clamped + 1);
      }
      return;
    }
    if (key === 'ArrowLeft') {
      event.preventDefault();
      if (event.shiftKey) {
        const marker = nextMarker(markers, clamped, -1);
        if (marker !== undefined) seek(marker.index);
      } else {
        seek(clamped - 1);
      }
      return;
    }
    if (key === 'PageUp' || key === 'PageDown') {
      event.preventDefault();
      const delta = key === 'PageUp' ? -PAGE_STEP_MS : PAGE_STEP_MS;
      seek(indexAtTime(events, timeAtIndex(events, clamped) + delta));
      return;
    }
    if (key === 'Home') {
      event.preventDefault();
      seek(0);
      return;
    }
    if (key === 'End') {
      event.preventDefault();
      seek(last);
      return;
    }
    if (key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      onPlayPause?.();
    }
  };

  const valueText = scrubValueText(events, clamped, markers);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={trackRef}
        data-testid="scrubber-track"
        className="relative h-11 cursor-ew-resize touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full border border-hairline bg-surface-1"
        />
        <div
          aria-hidden="true"
          data-testid="scrubber-progress"
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-teal-400/70 to-emerald-400/80"
          style={{ width: `${headPosition * 100}%` }}
        />

        {clusters.map((cluster) => {
          const [first] = cluster.markers;
          if (first === undefined) return null;
          const styles = MARKER_STYLE[first.kind];
          const Icon = MARKER_ICON[first.kind];
          const label = markerLabel(cluster.markers);
          const single = cluster.markers.length === 1;
          return (
            <div
              key={`${first.kind}-${first.index}`}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${(cluster.x / width) * 100}%` }}
            >
              <Tooltip content={label} side="top">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={label}
                  data-testid={single ? `scrubber-marker-${first.index}` : `scrubber-cluster-${first.index}`}
                  data-kind={first.kind}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onSeek(first.index)}
                  className={cn(
                    'flex h-4 min-w-4 items-center justify-center rounded-full border px-0.5 text-[9px] font-semibold shadow-sm focus-visible:outline-2',
                    styles.ring,
                    styles.text,
                  )}
                >
                  {single ? (
                    <Icon aria-hidden="true" className="h-2.5 w-2.5" />
                  ) : (
                    <span aria-hidden="true">{cluster.markers.length}</span>
                  )}
                </button>
              </Tooltip>
            </div>
          );
        })}

        <div
          ref={headRef}
          role="slider"
          tabIndex={0}
          aria-label="Replay position"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={clamped}
          aria-valuetext={valueText}
          data-testid="scrubber-head"
          data-dragging={isDragging ? 'true' : 'false'}
          onKeyDown={onKeyDown}
          className="absolute top-0 z-10 flex h-full w-3 -translate-x-1/2 cursor-ew-resize flex-col items-center justify-center outline-none"
          style={{
            left: `${headPosition * 100}%`,
            transition: reducedMotion || isDragging ? 'none' : 'left 120ms linear',
          }}
        >
          <span
            aria-hidden="true"
            className={cn(
              'h-4 w-1 rounded-full bg-teal-300 shadow-[0_0_0_2px_rgba(63,224,197,0.25)]',
              isDragging && 'bg-emerald-200',
            )}
          />
          <span aria-hidden="true" className="mt-0.5 h-2 w-2 rounded-full bg-teal-200" />
        </div>
      </div>

      <div className="flex items-center justify-between font-mono text-caption tabular-nums text-ink-3">
        <span data-testid="scrubber-clock">{scrubClockLabel(events, clamped)}</span>
        <span data-testid="scrubber-event-count">
          event {events.length === 0 ? 0 : clamped + 1} / {events.length}
        </span>
      </div>
    </div>
  );
}
