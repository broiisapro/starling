import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The legibility pass, enforced.
 *
 * Judges watch these five panels from the back of a room, so the lane has two hard floors:
 *
 * 1. **Text size.** 12 px is the smallest meta size, 14 px is body (`text-sm`). Anything between
 *    (13 px) is neither and is banned; anything below 12 px is unreadable on a projector.
 * 2. **Contrast.** On the dusk (`slate-950`) surface every informational word uses `slate-300/400`
 *    or a status colour; `slate-500` and darker measure under 4.5:1 and are banned outright.
 *
 * These are *source* assertions because Tailwind classes are the source of truth and happy-dom has
 * no stylesheet to compute. They cover every `.ts`/`.tsx` file in the lane, not just the components
 * a test happens to render, so a new card cannot quietly regress the floor.
 */
const FEATURES = new URL('../', import.meta.url).pathname;
const LANE = ['dag', 'agents', 'queue', 'metrics', 'flock'] as const;

interface Source {
  path: string;
  text: string;
}

function collect(dir: string, into: Source[] = []): Source[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      collect(path, into);
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    into.push({ path, text: readFileSync(path, 'utf8') });
  }
  return into;
}

const sources = LANE.flatMap((feature) => collect(join(FEATURES, feature)));

function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const source of sources) {
    const lines = source.text.split('\n');
    lines.forEach((line, index) => {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        hits.push(`${source.path.replace(FEATURES, '')}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  return hits;
}

test('the scan actually covers the lane', () => {
  // A guard against a silently empty scan (a moved folder would otherwise make every test pass).
  expect(sources.length).toBeGreaterThan(60);
  for (const feature of LANE) {
    expect(sources.some((source) => source.path.includes(`/${feature}/`))).toBe(true);
  }
});

test('no text is smaller than the 12 px meta floor', () => {
  const hits = offenders(/text-\[(\d+(?:\.\d+)?)px\]/g).filter((hit) => {
    const size = Number(/text-\[(\d+(?:\.\d+)?)px\]/.exec(hit)?.[1] ?? 99);
    return size < 12;
  });

  expect(hits).toEqual([]);
});

test('13 px is neither meta nor body and is not used', () => {
  const hits = offenders(/text-\[13(?:\.\d+)?px\]/);
  expect(hits).toEqual([]);
});

test('no informational text sits below 4.5:1 contrast on the dusk surface', () => {
  // slate-500 (#64748b) is 4.2:1 on slate-950; six-hundred and darker are worse. All banned.
  const hits = offenders(/text-(?:slate|gray|zinc|neutral|stone)-(?:5|6|7|8|9)00/);
  expect(hits).toEqual([]);
});

test('no text is italicised grey micro-copy at a size below the floor', () => {
  // `text-xs` is 12 px and allowed; `text-micro`/`text-caption` are shell tokens with their own
  // accessible roles, but a feature card must not reach for them.
  const hits = offenders(/\btext-micro\b|\btext-caption\b/);
  expect(hits).toEqual([]);
});
