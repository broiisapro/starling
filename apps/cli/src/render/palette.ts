import pc from 'picocolors';

/** The subset of picocolors' formatter bag the CLI uses. Tests inject a plain (no-colour) palette. */
export type Palette = ReturnType<typeof pc.createColors>;

/**
 * Pick a palette. Colour is opt-in by TTY and can be disabled with `NO_COLOR` or `FORCE_COLOR=0`,
 * matching the informal standard every terminal tool follows.
 */
export function createPalette(options: {
  isTTY: boolean;
  env?: Record<string, string | undefined>;
}): Palette {
  const env = options.env ?? {};
  const disabled = env.NO_COLOR !== undefined || env.FORCE_COLOR === '0';
  const forced = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0';
  return pc.createColors(forced || (options.isTTY && !disabled));
}

/** A palette with every formatter disabled — what non-TTY output and snapshots use. */
export function plainPalette(): Palette {
  return pc.createColors(false);
}

/** A palette forced on or off, for `--color`/tests. */
export function fixedPalette(enabled: boolean): Palette {
  return pc.createColors(enabled);
}
