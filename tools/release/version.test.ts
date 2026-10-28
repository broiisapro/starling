/**
 * Version resolution: `--version` wins, otherwise the root package.json. The suite writes its own
 * package.json files into `os.tmpdir()` so it never depends on this repo's current version.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDir } from './fs-util.ts';
import { packageVersion, resolveVersion } from './version.ts';

const dirs: string[] = [];

async function pkgFile(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'starling-release-version-'));
  dirs.push(dir);
  const path = join(dir, 'package.json');
  await writeFile(path, contents, 'utf8');
  return path;
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => removeDir(dir)));
});

describe('resolveVersion', () => {
  test('uses the flag when given', async () => {
    expect(await resolveVersion({ flag: '0.2.0' })).toBe('0.2.0');
  });

  test('strips the v from a tag-shaped flag', async () => {
    expect(await resolveVersion({ flag: 'v1.0.0' })).toBe('1.0.0');
  });

  test('the flag wins over package.json', async () => {
    const packageJsonPath = await pkgFile('{ "version": "9.9.9" }');
    expect(await resolveVersion({ flag: '0.3.0', packageJsonPath })).toBe('0.3.0');
  });

  test('falls back to package.json', async () => {
    const packageJsonPath = await pkgFile('{ "version": "0.4.1" }');
    expect(await resolveVersion({ packageJsonPath })).toBe('0.4.1');
  });
});

describe('packageVersion', () => {
  test('rejects JSON without a string version', async () => {
    const packageJsonPath = await pkgFile('{ "name": "x" }');
    expect(packageVersion(packageJsonPath)).rejects.toThrow(/has no string "version"/);
  });

  test('rejects malformed JSON with a path-bearing error', async () => {
    const packageJsonPath = await pkgFile('{ nope');
    expect(packageVersion(packageJsonPath)).rejects.toThrow(/is not valid JSON/);
  });

  test('rejects a version that is not semver', async () => {
    const packageJsonPath = await pkgFile('{ "version": "latest" }');
    expect(packageVersion(packageJsonPath)).rejects.toThrow(/not a semver version/);
  });

  test('reports a missing file instead of returning undefined', async () => {
    expect(packageVersion(join(tmpdir(), 'starling-does-not-exist', 'package.json'))).rejects.toThrow(
      /Cannot read/,
    );
  });
});
