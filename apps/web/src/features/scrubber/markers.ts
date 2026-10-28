import type { StarlingEvent } from '@starling/core/browser';

/**
 * The replay scrubber's marker model.
 *
 * Everything here is pure and DOM-free: a marker is `{ index, ts, kind, label }` where `index` is the
 * position in the event array the scrubber seeks to. Keeping the mapping out of the component means
 * the interesting moments of a recording ("theme failed its audit", "the Air came back") can be
 * tested against the real fixture without rendering anything.
 *
 * Positions are **proportional to time**, not to the event index: the launch-day fixture has a quiet
 * minute while the Air's lid is closed, and the track should show that as a gap rather than as a
 * handful of cramped markers.
 */

export type MarkerKind =
  | 'merge'
  | 'fail'
  | 'conflict'
  | 'node-join'
  | 'node-leave'
  | 'migrate'
  | 'plan'
  | 'finish';

export interface Marker {
  /** Index into the source event array. */
  index: number;
  /** Envelope timestamp of the event, epoch ms. */
  ts: number;
  kind: MarkerKind;
  /** Human label, used for tooltips, `aria-valuetext` and the preview's last-event line. */
  label: string;
}

/** Stable order for legends and tests. */
export const MARKER_KINDS: readonly MarkerKind[] = [
  'merge',
  'fail',
  'conflict',
  'node-join',
  'node-leave',
  'migrate',
  'plan',
  'finish',
];

/**
 * Filters offered as chips. `plan` and `finish` are always shown: a timeline with no beginning and no
 * end is harder to read than one with two calm bookends.
 */
export type MarkerFilter = 'merges' | 'failures' | 'nodes';

export const MARKER_FILTERS: readonly MarkerFilter[] = ['merges', 'failures', 'nodes'];

/** Merges and conflicts belong together; a conflict *is* a failed merge and a failure too. */
export function markerCategories(kind: MarkerKind): MarkerFilter[] {
  switch (kind) {
    case 'merge':
      return ['merges'];
    case 'conflict':
      return ['merges', 'failures'];
    case 'fail':
      return ['failures'];
    case 'node-join':
    case 'node-leave':
    case 'migrate':
      return ['nodes'];
    default:
      return [];
  }
}

/** Plan and finish markers have no category and never hide. */
export function isMarkerVisible(marker: Marker, active: readonly MarkerFilter[]): boolean {
  const categories = markerCategories(marker.kind);
  if (categories.length === 0) return true;
  return categories.some((category) => active.includes(category));
}

export function filterMarkers(markers: readonly Marker[], active: readonly MarkerFilter[]): Marker[] {
  if (active.length === MARKER_FILTERS.length) return [...markers];
  return markers.filter((marker) => isMarkerVisible(marker, active));
}

export type EventSpan = { start: number; end: number; duration: number };

/** First/last timestamp of a log. Empty logs collapse to a zero-length span at 0. */
export function eventSpan(events: readonly StarlingEvent[]): EventSpan {
  const first = events[0];
  const last = events.at(-1);
  if (first === undefined || last === undefined) return { start: 0, end: 0, duration: 0 };
  return { start: first.ts, end: last.ts, duration: Math.max(0, last.ts - first.ts) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function payloadOf(event: StarlingEvent): Record<string, unknown> {
  const payload = (event as { payload?: unknown }).payload;
  return isRecord(payload) ? payload : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nodeInfo(payload: Record<string, unknown>): { id?: string; name?: string } {
  const node = payload.node;
  if (!isRecord(node)) return {};
  return { id: text(node.id), name: text(node.name) };
}

function mergeMarker(payload: Record<string, unknown>, index: number, ts: number): Marker | undefined {
  const status = text(payload.status);
  if (status === undefined) return undefined;
  const taskKey = text(payload.taskKey) ?? 'task';
  if (status === 'merged') return { index, ts, kind: 'merge', label: `${taskKey} merged` };
  if (status === 'conflict') return { index, ts, kind: 'conflict', label: `${taskKey} conflict` };
  if (status === 'tests-failed') return { index, ts, kind: 'fail', label: `${taskKey} tests failed` };
  // `skipped` and unknown statuses are not interesting moments; the queue panel owns them.
  return undefined;
}

/**
 * One event → at most one marker. Structural reads rather than an exhaustive switch, because core is
 * growing additive event types (Epic 40's `run.status`) while this file ships.
 */
export function markerOf(
  event: StarlingEvent,
  index: number,
  nodeNames: ReadonlyMap<string, string> = new Map(),
): Marker | undefined {
  const type = (event as { type?: unknown }).type;
  const payload = payloadOf(event);
  const ts = event.ts;
  if (typeof type !== 'string') return undefined;

  if (type === 'merge.result') return mergeMarker(payload, index, ts);

  if (type === 'audit.verdict' && payload.pass === false) {
    return {
      index,
      ts,
      kind: 'fail',
      label: `${text(payload.taskKey) ?? 'task'} failed audit`,
    };
  }

  if (type === 'task.status' && payload.to === 'failed') {
    return { index, ts, kind: 'fail', label: `${text(payload.taskKey) ?? 'task'} failed` };
  }

  if (type === 'node.joined') {
    const node = nodeInfo(payload);
    const label = node.name ?? node.id ?? 'a perch';
    return { index, ts, kind: 'node-join', label: `${label} joined` };
  }

  if (type === 'node.left') {
    const id = text(payload.nodeId) ?? 'a perch';
    return { index, ts, kind: 'node-leave', label: `${nodeNames.get(id) ?? id} left` };
  }

  if (type === 'task.migrated') {
    const taskKey = text(payload.taskKey) ?? 'task';
    const fromNode = text(payload.fromNode) ?? '?';
    const toNode = text(payload.toNode) ?? '?';
    return { index, ts, kind: 'migrate', label: `${taskKey} migrated ${fromNode} → ${toNode}` };
  }

  if (type === 'plan.created') {
    const plan = payload.plan;
    const tasks = isRecord(plan) && Array.isArray(plan.tasks) ? plan.tasks.length : undefined;
    return {
      index,
      ts,
      kind: 'plan',
      label: tasks === undefined ? 'plan created' : `plan: ${tasks} ${tasks === 1 ? 'task' : 'tasks'}`,
    };
  }

  if (type === 'run.finished') return { index, ts, kind: 'finish', label: 'run finished' };

  return undefined;
}

/**
 * Every interesting moment in a log, oldest first. Node names are accumulated as the log is read so
 * a `node.left` marker says "MacBook Air left" rather than "air left".
 */
export function buildMarkers(events: readonly StarlingEvent[]): Marker[] {
  const markers: Marker[] = [];
  const nodeNames = new Map<string, string>();

  events.forEach((event, index) => {
    const type = (event as { type?: unknown }).type;
    if (type === 'node.joined' || type === 'node.stats') {
      const node = nodeInfo(payloadOf(event));
      if (node.id !== undefined && node.name !== undefined) nodeNames.set(node.id, node.name);
    }
    const marker = markerOf(event, index, nodeNames);
    if (marker !== undefined) markers.push(marker);
  });

  return markers;
}

/** Arrow-key navigation: the first marker strictly after (dir 1) or before (dir -1) `index`. */
export function nextMarker(markers: readonly Marker[], index: number, dir: 1 | -1): Marker | undefined {
  if (dir === 1) return markers.find((marker) => marker.index > index);
  for (let i = markers.length - 1; i >= 0; i -= 1) {
    const marker = markers[i];
    if (marker !== undefined && marker.index < index) return marker;
  }
  return undefined;
}

/** The next failed audit / failed merge after `index`; the "jump to next failure" button's target. */
export function nextFailure(markers: readonly Marker[], index: number): Marker | undefined {
  return markers.find(
    (marker) => marker.index > index && (marker.kind === 'fail' || marker.kind === 'conflict'),
  );
}

/** Number of events in a log, and the highest valid index (0 for an empty log). */
export function lastIndex(events: readonly StarlingEvent[]): number {
  return Math.max(0, events.length - 1);
}

export function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  const max = Math.max(0, length - 1);
  return Math.min(max, Math.max(0, Math.round(value)));
}

/** Timestamp of the event at `index`, clamped to the log. Empty logs answer 0. */
export function timeAtIndex(events: readonly StarlingEvent[], index: number): number {
  if (events.length === 0) return 0;
  const event = events[clampIndex(index, events.length)];
  return event?.ts ?? 0;
}

/**
 * The last event at or before `ts` (rightmost allowed index), by binary search.
 *
 * Logs are recorded in order, so this is O(log n) — important on a 5 000-event live run where every
 * pointer move asks the question. A timestamp before the first event clamps to 0; after the last,
 * to the end.
 */
export function indexAtTime(events: readonly StarlingEvent[], ts: number): number {
  const max = lastIndex(events);
  if (events.length === 0) return 0;
  const first = events[0];
  if (first === undefined || ts <= first.ts) return 0;
  const last = events[max];
  if (last === undefined || ts >= last.ts) return max;

  let low = 0;
  let high = max;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const event = events[mid];
    if (event !== undefined && event.ts <= ts) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** 0…1 position of a timestamp on the track. An empty or zero-length span answers 0. */
export function positionOfTime(ts: number, span: EventSpan): number {
  if (span.duration <= 0) return 0;
  return Math.min(1, Math.max(0, (ts - span.start) / span.duration));
}

/** Inverse of `positionOfTime`. */
export function timeAtPosition(position: number, span: EventSpan): number {
  if (span.duration <= 0) return span.start;
  return span.start + Math.min(1, Math.max(0, position)) * span.duration;
}

/**
 * Event index for a position on the track. Uses time, then the same rightmost-allowed binary search
 * as `indexAtTime`, so a click in the quiet minute selects the last event before it.
 */
export function indexAtPosition(events: readonly StarlingEvent[], position: number): number {
  if (events.length === 0) return 0;
  return indexAtTime(events, timeAtPosition(position, eventSpan(events)));
}

/** Event index for a horizontal pointer offset inside a track of `width` px. */
export function indexAtOffset(events: readonly StarlingEvent[], offsetPx: number, widthPx: number): number {
  if (!Number.isFinite(offsetPx) || !Number.isFinite(widthPx) || widthPx <= 0) return 0;
  return indexAtPosition(events, offsetPx / widthPx);
}

export interface PlacedMarker {
  marker: Marker;
  /** 0…1 along the track. */
  position: number;
}

/** Marker positions as fractions, so the component only has to multiply by its measured width. */
export function markerPositions(markers: readonly Marker[], span: EventSpan): PlacedMarker[] {
  return markers.map((marker) => ({ marker, position: positionOfTime(marker.ts, span) }));
}

export interface MarkerCluster {
  /** Centre in px from the start of the track. */
  x: number;
  markers: Marker[];
}

/**
 * Group markers whose pixel positions are closer than `minGapPx` (default 4). A long recording packs
 * dozens of merges into a few pixels; drawing them all produces an unreadable smear, so a cluster is
 * rendered as one dot with a count and the labels in its tooltip.
 */
export function clusterMarkers(
  placed: readonly PlacedMarker[],
  widthPx: number,
  minGapPx = 4,
): MarkerCluster[] {
  if (placed.length === 0) return [];
  const width = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : 1;
  const gap = Math.max(0, minGapPx);
  const clusters: MarkerCluster[] = [];

  for (const entry of placed) {
    const x = entry.position * width;
    const current = clusters.at(-1);
    if (current !== undefined && x - current.x < gap) {
      current.markers.push(entry.marker);
      continue;
    }
    clusters.push({ x, markers: [entry.marker] });
  }

  return clusters;
}

/** "1:35" / "1:02:03" — elapsed time on the replay clock. */
export function formatScrubTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** `T+1:35 / 5:56` — the label above the track. */
export function scrubClockLabel(events: readonly StarlingEvent[], index: number): string {
  const span = eventSpan(events);
  const elapsed = Math.max(0, timeAtIndex(events, index) - span.start);
  return `T+${formatScrubTime(elapsed)} / ${formatScrubTime(span.duration)}`;
}

/** The slider's spoken value: "1:35, theme failed audit" when the head sits on a marker. */
export function scrubValueText(
  events: readonly StarlingEvent[],
  index: number,
  markers: readonly Marker[],
): string {
  const span = eventSpan(events);
  const elapsed = Math.max(0, timeAtIndex(events, index) - span.start);
  const marker = markers.find((candidate) => candidate.index === index);
  const time = formatScrubTime(elapsed);
  return marker === undefined ? time : `${time}, ${marker.label}`;
}

/** Count markers per category for the filter chips. Plan/finish deliberately do not appear. */
export function markerCounts(markers: readonly Marker[]): Record<MarkerFilter, number> {
  const counts: Record<MarkerFilter, number> = { merges: 0, failures: 0, nodes: 0 };
  for (const marker of markers) {
    for (const category of markerCategories(marker.kind)) counts[category] += 1;
  }
  return counts;
}
