/**
 * Recording a real run without blowing the repository up.
 *
 * A real run's `agent.event` stream is the agent's transcripts: whole files, whole diffs, whole tool
 * outputs. Recording that verbatim produces tens of megabytes per run, which does not belong in git.
 * So the real recorder:
 * - truncates every long string inside an `agent.event` payload (400 chars, `…[truncated N]`), which
 *   keeps the shape and the gist that `starling replay` renders;
 * - stops recording `agent.event`/`metrics` once the file passes the byte budget, keeping the small
 *   lifecycle events (`run.created` → `task.status` → `run.finished`) so the recording still replays
 *   to a real summary.
 *
 * The cap is stated once here and printed by `starling run`, so a truncated recording never lies
 * about being complete.
 */
import type { StarlingEvent } from '@starling/core';
import { createEventRecorder, type EventRecorder } from '../jsonl';

/** Longest string kept inside an agent event payload. */
export const MAX_AGENT_STRING = 400;
/** Byte budget per recording (5 MB, per the epic's definition of done). */
export const MAX_RECORDING_BYTES = 5 * 1024 * 1024;

function clip(text: string): string {
  if (text.length <= MAX_AGENT_STRING) return text;
  return `${text.slice(0, MAX_AGENT_STRING)}…[truncated ${text.length - MAX_AGENT_STRING} chars]`;
}

/** Truncate long strings two levels deep — the depth every `AgentEvent.data` shape uses. */
function clipRecord(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      out[key] = clip(entry);
    } else if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
      const nested: Record<string, unknown> = {};
      for (const [innerKey, inner] of Object.entries(entry as Record<string, unknown>)) {
        nested[innerKey] = typeof inner === 'string' ? clip(inner) : inner;
      }
      out[key] = nested;
    } else {
      out[key] = entry;
    }
  }
  return out;
}

/** The event as it should be written: agent payloads clipped, everything else untouched. */
export function compactEvent(event: StarlingEvent): StarlingEvent {
  if (event.type !== 'agent.event') return event;
  return { ...event, payload: { ...event.payload, data: clipRecord(event.payload.data) } };
}

export interface CompactRecorder extends EventRecorder {
  /** True once the byte budget forced agent events to be dropped. */
  readonly capped: boolean;
  /** How many agent events were dropped after the cap. */
  readonly dropped: number;
}

export interface CompactRecorderOptions {
  /** Byte budget. Defaults to {@link MAX_RECORDING_BYTES}; tests shrink it. */
  maxBytes?: number;
}

export function createCompactEventRecorder(
  path: string,
  cwd = process.cwd(),
  options: CompactRecorderOptions = {},
): CompactRecorder {
  const maxBytes = options.maxBytes ?? MAX_RECORDING_BYTES;
  const inner = createEventRecorder(path, cwd);
  let bytes = 0;
  let capped = false;
  let dropped = 0;

  const recorder: CompactRecorder = {
    path: inner.path,
    get count() {
      return inner.count;
    },
    get capped() {
      return capped;
    },
    get dropped() {
      return dropped;
    },
    record(event) {
      const compact = compactEvent(event);
      const size = JSON.stringify(compact).length + 1;
      if (bytes + size > maxBytes) {
        // Lifecycle events are what make a recording replayable; agent chatter is what fills a disk.
        if (event.type === 'agent.event' || event.type === 'metrics') {
          capped = true;
          dropped += 1;
          return;
        }
      }
      bytes += size;
      inner.record(compact);
    },
  };
  return recorder;
}
