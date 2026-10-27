import type { StarlingEvent } from '@starling/core/browser';

/**
 * Browser-safe structural guard for a `StarlingEvent` envelope.
 *
 * Wave 2 imports `@starling/core/browser`, so this module no longer drags the config loader (and its
 * `node:fs`/`node:path`) into the bundle. The guard stays local and dependency-free on purpose: the
 * feature playgrounds and dev-time fixture readers do not need zod.
 *
 * It is deliberately shallow: one of the documented event types, a string `runId`, a numeric `ts` and
 * an object payload. Deep payload validation stays where it belongs (the shell's boundary and every
 * package's own zod schema). `run.status` is included ahead of core's additive event so a hub that
 * publishes it (Epic 40) is not filtered out by an older UI.
 */
const EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  'run.created',
  'run.status',
  'repomap.ready',
  'plan.created',
  'task.status',
  'agent.event',
  'audit.verdict',
  'merge.result',
  'metrics',
  'log',
  'node.joined',
  'node.left',
  'node.stats',
  'task.migrated',
  'run.finished',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isStarlingEvent(value: unknown): value is StarlingEvent {
  if (!isRecord(value)) return false;
  if (typeof value.type !== 'string' || !EVENT_TYPES.has(value.type)) return false;
  if (typeof value.runId !== 'string' || typeof value.ts !== 'number') return false;
  return isRecord(value.payload);
}

/**
 * Parse a JSONL event log, skipping lines that are not valid JSON or not a plausible event.
 * Returns the events and the number of skipped lines so a playground can say so instead of lying.
 */
export function parseEventLines(text: string): { events: StarlingEvent[]; skipped: number } {
  const events: StarlingEvent[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      skipped += 1;
      continue;
    }
    if (isStarlingEvent(raw)) events.push(raw);
    else skipped += 1;
  }
  return { events, skipped };
}
