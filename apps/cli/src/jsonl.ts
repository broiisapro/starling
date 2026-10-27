import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { StarlingEvent } from '@starling/core';
import { StarlingError, StarlingEventSchema } from '@starling/core';

/**
 * Parse a JSONL event recording. Blank lines are skipped; a bad line fails with its number so a
 * hand-edited fixture is easy to fix.
 */
export function parseEventsJsonl(text: string, source = '<jsonl>'): StarlingEvent[] {
  const events: StarlingEvent[] = [];
  const lines = text.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] as string).trim();
    if (line.length === 0) continue;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      throw new StarlingError('INVALID_ARGUMENT', `${source}:${index + 1}: not valid JSON`, {
        cause: err,
        details: { source, line: index + 1 },
      });
    }

    const parsed = StarlingEventSchema.safeParse(raw);
    if (!parsed.success) {
      const reason = parsed.error.issues
        .slice(0, 2)
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new StarlingError(
        'INVALID_ARGUMENT',
        `${source}:${index + 1}: invalid Starling event (${reason})`,
        {
          cause: parsed.error,
          details: { source, line: index + 1 },
        },
      );
    }
    events.push(parsed.data);
  }

  return events;
}

export function readEventsJsonl(path: string, cwd = process.cwd()): StarlingEvent[] {
  const file = resolve(cwd, path);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new StarlingError('INVALID_ARGUMENT', `Could not read recording at ${file}`, {
      cause: err,
      details: { path: file },
    });
  }
  return parseEventsJsonl(text, file);
}

export interface EventRecorder {
  path: string;
  count: number;
  record(event: StarlingEvent): void;
}

/**
 * Append every event to a JSONL file as it happens.
 *
 * Deliberately store-free: `--record` must work even when no store is configured. Writes are
 * synchronous so a Ctrl-C still leaves a complete recording up to the last event.
 */
export function createEventRecorder(path: string, cwd = process.cwd()): EventRecorder {
  const file = resolve(cwd, path);
  mkdirSync(dirname(file), { recursive: true });

  const recorder: EventRecorder = {
    path: file,
    count: 0,
    record(event: StarlingEvent): void {
      appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
      recorder.count += 1;
    },
  };
  return recorder;
}
