import { describe, expect, test } from 'bun:test';
import { LiveView } from './live-view';
import { plainPalette } from './render/palette';
import { liveState } from './testing/fixtures';

function collector() {
  const chunks: string[] = [];
  return { chunks, write: (text: string) => chunks.push(text) };
}

describe('LiveView', () => {
  test('non-TTY output is plain append-only frames', () => {
    const out = collector();
    const view = new LiveView({
      write: out.write,
      isTTY: false,
      palette: plainPalette(),
      now: () => 1000,
      columns: 90,
    });
    expect(view.render(liveState(), { force: true })).toBe(true);
    view.close();
    const text = out.chunks.join('');
    expect(text).not.toContain('\x1b[');
    expect(text).toContain('Starling');
    expect(text.endsWith('\n')).toBe(true);
  });

  test('TTY redraw hides the cursor and moves it up over the previous frame', () => {
    const out = collector();
    let now = 1000;
    const view = new LiveView({
      write: out.write,
      isTTY: true,
      palette: plainPalette(),
      now: () => now,
      columns: 90,
      minIntervalMs: 250,
    });
    view.render(liveState(), { force: true });
    now = 1400;
    view.render(liveState(), { force: true });
    view.close();

    const text = out.chunks.join('');
    expect(text).toContain('\x1b[?25l'); // hide
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting ANSI cursor movement is the point.
    expect(text).toMatch(/\x1b\[\d+A/); // cursor up
    expect(text).toContain('\x1b[2K'); // clear line
    expect(text).toContain('\x1b[?25h'); // show
  });

  test('throttles redraws to at most four per second', () => {
    const out = collector();
    let now = 1000;
    const view = new LiveView({
      write: out.write,
      isTTY: false,
      palette: plainPalette(),
      now: () => now,
      columns: 90,
    });
    expect(view.render(liveState({ now, logs: [`tick ${now}`] }))).toBe(true);
    now = 1100;
    expect(view.render(liveState({ now, logs: [`tick ${now}`] }))).toBe(false);
    now = 1249;
    expect(view.render(liveState({ now, logs: [`tick ${now}`] }))).toBe(false);
    now = 1250;
    expect(view.render(liveState({ now, logs: [`tick ${now}`] }))).toBe(true);
    now = 1300;
    expect(view.render(liveState({ now, logs: [`tick ${now}`] }))).toBe(false);
    now = 1301;
    expect(view.render(liveState({ now, logs: [`tick ${now}`] }), { force: true })).toBe(true);
    view.close();
  });

  test('skips a frame that is identical to the previous one', () => {
    const out = collector();
    let now = 1000;
    const view = new LiveView({
      write: out.write,
      isTTY: false,
      palette: plainPalette(),
      now: () => now,
      columns: 90,
    });
    const state = liveState();
    expect(view.render(state, { force: true })).toBe(true);
    now = 2000;
    expect(view.render(state)).toBe(false);
    view.close();
  });

  test('close is idempotent and silences later frames', () => {
    const out = collector();
    const view = new LiveView({
      write: out.write,
      isTTY: false,
      palette: plainPalette(),
      now: () => 1000,
      columns: 80,
    });
    view.close();
    view.close();
    expect(view.render(liveState(), { force: true })).toBe(false);
    expect(out.chunks.join('')).toBe('');
  });
});
