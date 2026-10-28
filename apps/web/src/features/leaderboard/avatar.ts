/**
 * Tiny procedural starlings.
 *
 * Every entry on the leaderboard gets the same bird in every board, because the avatar is derived
 * from the task (or node) key alone — deterministic, no images, no network, no `Math.random()` in
 * render. The SVG itself lives in `BirdAvatar.tsx`; this module is pure and DOM-free.
 */

export const AVATAR_PATTERNS = ['speckle', 'streak', 'spangle', 'dapple'] as const;
export type AvatarPattern = (typeof AVATAR_PATTERNS)[number];

export const AVATAR_EYES = ['open', 'half', 'wide'] as const;
export type AvatarEye = (typeof AVATAR_EYES)[number];

export const AVATAR_WINGS = ['folded', 'open', 'flick'] as const;
export type AvatarWing = (typeof AVATAR_WINGS)[number];

export interface AvatarSpeckle {
  /** Coordinates in the 24×24 viewBox used by `BirdAvatar`. */
  cx: number;
  cy: number;
  r: number;
  /** Absolute hue, already mixed from the bird's base hue. */
  hue: number;
  opacity: number;
}

export interface AvatarSpec {
  seed: string;
  /** Raw FNV-1a hash; exported so tests can pin determinism without duplicating the algorithm. */
  hash: number;
  /** Base plumage hue, 0…359. */
  hue: number;
  /** Secondary hue for the gradient; always offset from `hue`. */
  accentHue: number;
  pattern: AvatarPattern;
  eye: AvatarEye;
  wing: AvatarWing;
  /** Head tilt in degrees, −6…6. */
  tilt: number;
  speckles: AvatarSpeckle[];
}

/** FNV-1a, 32-bit. Stable across engines and platforms (unlike `hashCode` folklore). */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: a tiny deterministic PRNG so a seed's plumage is a pure function of the hash. */
function random(hash: number): () => number {
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(list: readonly T[], value: number): T {
  const index = Math.min(list.length - 1, Math.floor(value * list.length));
  // `index` is always in range because `value` is < 1; the assertion keeps `noUncheckedIndexedAccess` honest.
  return list[index] as T;
}

/**
 * Starling iridescence: teal, blue, purple, green and rose. The base hue is drawn from that band
 * rather than the whole wheel, so the flock reads as one species on a projector.
 */
const PLUMAGE_BANDS: readonly [number, number][] = [
  [156, 196], // teal → cyan
  [196, 236], // cyan → blue
  [248, 292], // violet → purple
  [88, 128], // green
  [320, 350], // rose
];

function mixHue(base: number, offset: number): number {
  return (((base + offset) % 360) + 360) % 360;
}

export function birdAvatar(seed: string): AvatarSpec {
  const hash = hashSeed(seed);
  const next = random(hash);

  const [from, to] = pick(PLUMAGE_BANDS, next());
  const hue = Math.round(from + next() * (to - from));
  const accentHue = mixHue(hue, 24 + Math.round(next() * 64));
  const pattern = pick(AVATAR_PATTERNS, next());
  const eye = pick(AVATAR_EYES, next());
  const wing = pick(AVATAR_WINGS, next());
  const tilt = Math.round((next() * 12 - 6) * 10) / 10;

  const count = 4 + Math.floor(next() * 4);
  const speckles: AvatarSpeckle[] = [];
  for (let index = 0; index < count; index += 1) {
    // Rejection-free: sample inside the body ellipse by scaling a disc of radius 1.
    const angle = next() * Math.PI * 2;
    const radius = Math.sqrt(next()) * 0.72;
    speckles.push({
      cx: Math.round((12 + Math.cos(angle) * radius * 4.1) * 100) / 100,
      cy: Math.round((12.6 + Math.sin(angle) * radius * 4.5) * 100) / 100,
      r: Math.round((0.45 + next() * 0.5) * 100) / 100,
      hue: mixHue(hue, 30 + index * 47),
      opacity: Math.round((0.45 + next() * 0.4) * 100) / 100,
    });
  }

  return { seed, hash, hue, accentHue, pattern, eye, wing, tilt, speckles };
}

/** CSS `hsl()` string for a hue, shared by the SVG and any future HTML swatch. */
export function plumageColor(hue: number, saturation = 62, lightness = 58): string {
  return `hsl(${Math.round(hue)}, ${saturation}%, ${lightness}%)`;
}
