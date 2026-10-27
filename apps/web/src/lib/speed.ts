/** Demo playback speeds. Kept in one place so the URL, the store and the Layout agree. */
export const DEMO_SPEEDS = [1, 4, 16] as const;

export type DemoSpeed = (typeof DEMO_SPEEDS)[number];

export const DEFAULT_DEMO_SPEED: DemoSpeed = 1;

export function isDemoSpeed(value: unknown): value is DemoSpeed {
  return value === 1 || value === 4 || value === 16;
}

export function parseDemoSpeed(value: string | null | undefined): DemoSpeed | undefined {
  if (value === null || value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return isDemoSpeed(parsed) ? parsed : undefined;
}

/** Every speed except the active one — useful for the speed control's options. */
export function otherSpeeds(speed: DemoSpeed): DemoSpeed[] {
  return DEMO_SPEEDS.filter((candidate) => candidate !== speed);
}
