/**
 * The asset-name contract. These strings are shared with the installer (Epic 152), so a change here
 * is a breaking change for `tools/install` — the tests spell the names out literally on purpose.
 */
import { describe, expect, test } from 'bun:test';
import {
  assetName,
  hostTarget,
  normalizeVersion,
  parseTargetId,
  selectTargets,
  TARGETS,
  targetId,
  topLevelDir,
} from './targets.ts';

const DARWIN_ARM = TARGETS[0];
const DARWIN_X64 = TARGETS[1];
const LINUX_X64 = TARGETS[2];

describe('TARGETS', () => {
  test('is the three targets the installer supports', () => {
    expect(TARGETS.map(targetId)).toEqual(['darwin-arm64', 'darwin-x64', 'linux-x64']);
    expect(TARGETS.map((target) => target.bunTarget)).toEqual([
      'bun-darwin-arm64',
      'bun-darwin-x64',
      'bun-linux-x64',
    ]);
  });

  test('there is deliberately no linux-arm64 build', () => {
    expect(TARGETS.map(targetId)).not.toContain('linux-arm64');
  });
});

describe('assetName', () => {
  test('is starling-<version>-<os>-<arch>.tar.gz', () => {
    expect(assetName('0.1.0', DARWIN_ARM)).toBe('starling-0.1.0-darwin-arm64.tar.gz');
    expect(assetName('0.1.0', DARWIN_X64)).toBe('starling-0.1.0-darwin-x64.tar.gz');
    expect(assetName('0.1.0', LINUX_X64)).toBe('starling-0.1.0-linux-x64.tar.gz');
  });

  test('strips a leading v, because release tags carry one', () => {
    expect(assetName('v0.1.0', DARWIN_ARM)).toBe('starling-0.1.0-darwin-arm64.tar.gz');
  });

  test('the top-level directory is the asset name without .tar.gz', () => {
    expect(topLevelDir('1.2.3', LINUX_X64)).toBe('starling-1.2.3-linux-x64');
  });

  test('rejects a non-semver version instead of producing an undownloadable name', () => {
    expect(() => assetName('latest', DARWIN_ARM)).toThrow(/not a semver version/);
    expect(() => assetName('v', DARWIN_ARM)).toThrow(/not a semver version/);
  });
});

describe('normalizeVersion', () => {
  test('accepts plain, v-prefixed, pre-release and build versions', () => {
    expect(normalizeVersion('0.1.0')).toBe('0.1.0');
    expect(normalizeVersion('v0.1.0')).toBe('0.1.0');
    expect(normalizeVersion(' 1.2.3 ')).toBe('1.2.3');
    expect(normalizeVersion('1.2.3-rc.1')).toBe('1.2.3-rc.1');
    expect(normalizeVersion('1.2.3+build.5')).toBe('1.2.3+build.5');
  });

  test('rejects two-component versions and words', () => {
    expect(() => normalizeVersion('1.2')).toThrow();
    expect(() => normalizeVersion('next')).toThrow();
  });
});

describe('hostTarget', () => {
  test('darwin arm64', () => {
    expect(targetId(hostTarget('darwin', 'arm64'))).toBe('darwin-arm64');
  });

  test('darwin x64', () => {
    expect(targetId(hostTarget('darwin', 'x64'))).toBe('darwin-x64');
  });

  test('linux x64', () => {
    expect(targetId(hostTarget('linux', 'x64'))).toBe('linux-x64');
  });

  test('accepts the uname spellings aarch64/x86_64', () => {
    expect(targetId(hostTarget('linux', 'x86_64'))).toBe('linux-x64');
    expect(targetId(hostTarget('darwin', 'aarch64'))).toBe('darwin-arm64');
  });

  test('throws with the supported list on an unsupported platform', () => {
    expect(() => hostTarget('win32', 'x64')).toThrow(/darwin-arm64, darwin-x64, linux-x64/);
  });

  test('throws on linux-arm64, which this repo does not build', () => {
    expect(() => hostTarget('linux', 'arm64')).toThrow(/No release asset is built for linux-arm64/);
  });
});

describe('parseTargetId', () => {
  test('maps every id back to its target', () => {
    expect(parseTargetId('darwin-arm64')).toBe(DARWIN_ARM);
    expect(parseTargetId('darwin-x64')).toBe(DARWIN_X64);
    expect(parseTargetId('linux-x64')).toBe(LINUX_X64);
  });

  test('lists the supported targets on an unknown one', () => {
    expect(() => parseTargetId('windows-x64')).toThrow(/Supported targets: darwin-arm64/);
  });
});

describe('selectTargets', () => {
  test('host is one target', () => {
    expect(selectTargets('host', DARWIN_X64)).toEqual([DARWIN_X64]);
  });

  test('all is every target, in matrix order', () => {
    expect(selectTargets('all', DARWIN_ARM)).toEqual([...TARGETS]);
  });

  test('an id selects exactly that target', () => {
    expect(selectTargets('linux-x64', DARWIN_ARM)).toEqual([LINUX_X64]);
  });
});
