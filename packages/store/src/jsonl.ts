/**
 * JSONL recordings — the demo safety net.
 *
 * A recording is one `StarlingEvent` per line, exactly the bytes the recorder wrote. Import is
 * zod-validated line by line and fails on the first bad line with its 1-based file line number, so
 * a truncated or hand-edited file is caught before it reaches the engine.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { StarlingError, type StarlingEvent, StarlingEventSchema } from '@starling/core';

/** Serialise events the way `exportJsonl` / `--record` write them: one compact JSON object per line. */
export function serialiseJsonl(events: readonly StarlingEvent[]): string {
  if (events.length === 0) return '';
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

/** Write an event stream to `path` (overwrites). Throws `STORE_ERROR` when the file cannot be written. */
export function writeJsonl(path: string, events: readonly StarlingEvent[]): void {
  try {
    writeFileSync(path, serialiseJsonl(events));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new StarlingError('STORE_ERROR', `could not write recording to ${path}: ${detail}`, { cause: err });
  }
}

/**
 * Parse and validate a JSONL recording. Blank lines are skipped but still counted, so error line
 * numbers match a text editor's.
 */
export function parseJsonl(text: string, source = '<string>'): StarlingEvent[] {
  const events: StarlingEvent[] = [];
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;
    const lineNumber = index + 1;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new StarlingError('STORE_ERROR', `invalid JSON on line ${lineNumber} of ${source}: ${detail}`, {
        cause: err,
        details: { line: lineNumber, source },
      });
    }

    const parsed = StarlingEventSchema.safeParse(raw);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<root>'}: ${issue.message}`)
        .join('; ');
      throw new StarlingError(
        'STORE_ERROR',
        `invalid StarlingEvent on line ${lineNumber} of ${source}: ${detail}`,
        {
          cause: parsed.error,
          details: { line: lineNumber, source },
        },
      );
    }
    events.push(parsed.data);
  }

  return events;
}

/** Read a JSONL recording from disk. Throws `STORE_ERROR` for unreadable files or invalid lines. */
export function importJsonl(path: string): StarlingEvent[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new StarlingError('STORE_ERROR', `could not read recording at ${path}: ${detail}`, { cause: err });
  }
  return parseJsonl(text, path);
}
