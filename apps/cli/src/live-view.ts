import type { LiveState } from './live-state';
import { renderLive } from './render/live';
import type { Palette } from './render/palette';

export interface LiveViewOptions {
  write(text: string): void;
  isTTY: boolean;
  now?: () => number;
  columns?: number;
  palette: Palette;
  /** Minimum wall-clock gap between redraws. Four frames a second is the ceiling. */
  minIntervalMs?: number;
}

/**
 * Drives `renderLive` in a terminal.
 *
 * - TTY: cursor-up redraw with `\x1b[2K` line clears; the cursor is hidden while live.
 * - non-TTY (CI, pipes, recordings): plain append-only frames, no escape codes.
 * - At most one frame per `minIntervalMs` (250 ms → ≤ 4 frames/s). `render(state, { force: true })`
 *   bypasses the throttle so the final screen is always the latest state.
 */
export class LiveView {
  readonly #write: (text: string) => void;
  readonly #isTTY: boolean;
  readonly #now: () => number;
  readonly #columns: number;
  readonly #palette: Palette;
  readonly #minIntervalMs: number;
  #lastDraw = Number.NEGATIVE_INFINITY;
  #lastLines: string[] = [];
  #drawn = false;
  #closed = false;

  constructor(options: LiveViewOptions) {
    this.#write = options.write;
    this.#isTTY = options.isTTY;
    this.#now = options.now ?? (() => Date.now());
    this.#columns = options.columns ?? 100;
    this.#palette = options.palette;
    this.#minIntervalMs = options.minIntervalMs ?? 250;
  }

  /** Draw a frame. Returns true when something was written. */
  render(state: LiveState, options: { force?: boolean } = {}): boolean {
    if (this.#closed) return false;
    const now = this.#now();
    if (options.force !== true && now - this.#lastDraw < this.#minIntervalMs) return false;

    const frame = renderLive(state, { palette: this.#palette, width: this.#columns });
    const lines = frame.split('\n');
    if (!options.force && sameLines(lines, this.#lastLines) && this.#drawn) return false;

    if (this.#isTTY) this.#drawTTY(lines);
    else this.#write(`${frame}\n`);

    this.#lastLines = lines;
    this.#lastDraw = now;
    this.#drawn = true;
    return true;
  }

  /** Restore the cursor and finish the last frame with a newline. Idempotent. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#isTTY && this.#drawn) this.#write('\x1b[?25h');
    if (this.#isTTY && this.#drawn) this.#write('\n');
  }

  #drawTTY(lines: string[]): void {
    if (!this.#drawn) {
      this.#write('\x1b[?25l'); // hide cursor
    } else {
      this.#write(`\x1b[${this.#lastLines.length}A`);
    }
    for (const line of lines) {
      this.#write(`\x1b[2K${line}\n`);
    }
    if (this.#lastLines.length > lines.length) {
      this.#write('\x1b[J'); // clear leftovers from a taller previous frame
    }
  }
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}
