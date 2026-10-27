import { describe, expect, test } from 'bun:test';
import {
  AVATAR_EYES,
  AVATAR_PATTERNS,
  AVATAR_WINGS,
  type AvatarSpec,
  birdAvatar,
  hashSeed,
  plumageColor,
} from './avatar';

const SEEDS = ['dates-fix', 'theme', 'hub', 'air', 'search', 'csv-export', 'help-overlay', ''];

function expectValid(spec: AvatarSpec): void {
  expect(spec.hue).toBeGreaterThanOrEqual(0);
  expect(spec.hue).toBeLessThanOrEqual(359);
  expect(spec.accentHue).toBeGreaterThanOrEqual(0);
  expect(spec.accentHue).toBeLessThanOrEqual(359);
  expect(AVATAR_PATTERNS).toContain(spec.pattern);
  expect(AVATAR_EYES).toContain(spec.eye);
  expect(AVATAR_WINGS).toContain(spec.wing);
  expect(spec.tilt).toBeGreaterThanOrEqual(-6);
  expect(spec.tilt).toBeLessThanOrEqual(6);
  expect(spec.speckles.length).toBeGreaterThanOrEqual(4);
  expect(spec.speckles.length).toBeLessThanOrEqual(7);
  for (const speckle of spec.speckles) {
    expect(speckle.r).toBeGreaterThan(0);
    expect(speckle.opacity).toBeGreaterThan(0);
    expect(speckle.opacity).toBeLessThanOrEqual(1);
    expect(speckle.hue).toBeGreaterThanOrEqual(0);
    expect(speckle.hue).toBeLessThanOrEqual(359);
    // Inside the 24×24 body/head silhouette.
    expect(speckle.cx).toBeGreaterThan(7);
    expect(speckle.cx).toBeLessThan(17);
    expect(speckle.cy).toBeGreaterThan(3.5);
    expect(speckle.cy).toBeLessThan(18);
  }
}

describe('birdAvatar', () => {
  test('is a pure function of the seed', () => {
    expect(birdAvatar('dates-fix')).toEqual(birdAvatar('dates-fix'));
    expect(birdAvatar('theme')).toEqual(birdAvatar('theme'));
  });

  test('every fixture bird yields a valid spec', () => {
    for (const seed of SEEDS) expectValid(birdAvatar(seed));
  });

  test('different seeds produce different plumage', () => {
    const specs = SEEDS.map((seed) => birdAvatar(seed));
    const signatures = new Set(
      specs.map((spec) => `${spec.hue}/${spec.accentHue}/${spec.pattern}/${spec.eye}`),
    );
    expect(signatures.size).toBeGreaterThan(SEEDS.length - 2);
  });

  test('hashSeed is FNV-1a: unsigned, stable and distinct', () => {
    expect(hashSeed('starling')).toBe(hashSeed('starling'));
    expect(hashSeed('starling')).not.toBe(hashSeed('starling2'));
    for (const seed of SEEDS) {
      const hash = hashSeed(seed);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffff_ffff);
    }
  });

  test('the empty seed still draws a bird rather than throwing', () => {
    expectValid(birdAvatar(''));
  });
});

test('plumageColor renders a rounded hsl() string', () => {
  expect(plumageColor(180.4)).toBe('hsl(180, 62%, 58%)');
  expect(plumageColor(12, 78, 66)).toBe('hsl(12, 78%, 66%)');
});
