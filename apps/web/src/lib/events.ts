import type { StarlingEvent } from '@starling/core';

/**
 * Browser-safe structural guard for a `StarlingEvent` envelope.
 *
 * Why this exists: `@starling/core`'s root barrel re-exports its config loader (which imports
 * `node:fs`), so a *runtime* import from core in browser code drags Node builtins into the bundle.
 * The web app's contract validation lives in `src/data/demo.ts` (the JSONL boundary, where zod is
 * worth its weight); everywhere else — the feature playgrounds and the dev-time fixture readers —
 * this guard is enough and costs nothing.
 *
 * It is deliberately shallow: one of the fifteen documented event types, a string `runId`, a numeric
 * `ts` and an object payload. Deep payload validation stays where it belongs (the shell's boundary
 * and every package's own zod schema).
 *
 * Wave 2 can replace this with `@starling/core/browser` once the browser entry point lands.
 */
const EVENT_TYPES: ReadonlySet<string> = new Set<StarlingEvent['type']>([
  'run.created',
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
