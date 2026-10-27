/**
 * cli-args.ts — the four lines of flag parsing these scripts need, shared so `bench.ts` and
 * `recommend.ts` accept the same `--flag value` and `--flag=value` spellings (like smoke.ts does).
 */

/** `--name value` or `--name=value`; undefined when absent. */
export function argValue(argv: string[], name: string): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) {
    const next = argv[i + 1] as string;
    return next.startsWith('--') ? undefined : next;
  }
  return undefined;
}

/** `--name a,b` → ['a', 'b']. Empty and whitespace-only entries are dropped. */
export function argList(argv: string[], name: string): string[] | undefined {
  const raw = argValue(argv, name);
  if (raw === undefined) return undefined;
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

export function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

/** Numeric flag with a fallback. Returns NaN when the value is present but not a number. */
export function argNumber(argv: string[], name: string, fallback: number): number {
  const raw = argValue(argv, name);
  if (raw === undefined) return fallback;
  return Number(raw);
}

/** `true` unless `--no-write` is present, so a dry run never has to remember it. */
export function writesEnabled(argv: string[]): boolean {
  return !hasFlag(argv, 'no-write');
}
