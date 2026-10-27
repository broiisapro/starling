import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { EMPTY, formatClock, formatCount, formatTimestamp } from './format';

const FORMAT_PATH = join(import.meta.dir, 'format.ts');

/**
 * A timestamp whose UTC wall clock is 15:18 on 27 Oct. In America/Toronto that is 11:18 on the same
 * day, so if any formatter ever falls back to local time the probe output changes with `TZ`.
 */
const ISO = '2026-10-27T15:18:16Z';

const SAMPLES = [
  ISO,
  '2026-01-05T00:04:00Z', // single-digit day, midnight hour — padding
  '2026-12-31T23:59:59Z', // month/year boundary, last minute
  '2026-03-08T05:04:00Z', // a US DST changeover date, where local time is ambiguous
];

const PROBE = `
import { formatClock, formatCount, formatTimestamp } from ${JSON.stringify(FORMAT_PATH)};
const samples = ${JSON.stringify(SAMPLES)};
console.log(JSON.stringify({
  stamps: samples.map(formatTimestamp),
  clock: formatClock(Date.parse(${JSON.stringify(ISO)})),
  count: formatCount(1234567),
}));
`;

/** Run the formatters in a fresh Bun process with `TZ` set, and return their JSON output. */
async function probe(tz: string, locale?: string): Promise<string> {
  const env: Record<string, string | undefined> = { ...process.env, TZ: tz };
  if (locale !== undefined) {
    env.LANG = locale;
    env.LC_ALL = locale;
  }
  const child = Bun.spawn([process.execPath, '-e', PROBE], {
    cwd: join(import.meta.dir, '..', '..', '..'),
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`probe under TZ=${tz} exited ${code}: ${err}`);
  return out.trim();
}

test('timestamp and clock formatting is identical under different TZ values', async () => {
  const [utc, toronto, turkish] = await Promise.all([
    probe('UTC'),
    probe('America/Toronto'),
    // CI also runs under a non-English locale; a stray `toLocale*` call would surface here.
    probe('Europe/Istanbul', 'tr_TR.UTF-8'),
  ]);
  expect(toronto).toBe(utc);
  expect(turkish).toBe(utc);
  expect(JSON.parse(utc)).toEqual({
    stamps: ['27 Oct at 15:18 UTC', '05 Jan at 00:04 UTC', '31 Dec at 23:59 UTC', '08 Mar at 05:04 UTC'],
    clock: '15:18',
    count: '1,234,567',
  });
});

test('formatters read UTC parts, never the host time zone', () => {
  const ms = Date.parse(ISO);

  expect(formatTimestamp(ISO)).toBe('27 Oct at 15:18 UTC');
  expect(formatClock(ms)).toBe('15:18');
  // The same instant one minute before midnight UTC next day still renders the UTC day.
  expect(formatTimestamp('2026-10-28T00:00:00Z')).toBe('28 Oct at 00:00 UTC');
  expect(formatClock(Date.parse('2026-10-28T00:00:00Z'))).toBe('00:00');
  expect(formatClock(Number.NaN)).toBe(EMPTY);
  expect(formatTimestamp(undefined)).toBe(EMPTY);
});

test('counts group with commas and never go through Intl', () => {
  expect(formatCount(0)).toBe('0');
  expect(formatCount(999)).toBe('999');
  expect(formatCount(1000)).toBe('1,000');
  expect(formatCount(1234567)).toBe('1,234,567');
  expect(formatCount(-1234)).toBe('-1,234');
  expect(formatCount(1234.5)).toBe('1,234.5');
  expect(formatCount(Number.POSITIVE_INFINITY)).toBe(EMPTY);
});
