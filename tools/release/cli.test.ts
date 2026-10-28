/**
 * CLI flag parsing for both scripts. Pure functions, so the matrix is covered without spawning
 * anything: a release script that silently ignores `--target linux-x64` is worse than one that errors.
 */
import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { parseBuildArgs, USAGE } from './build.ts';
import { DRY_RUN_USAGE, parseDryRunArgs } from './dry-run.ts';
import { TARGETS } from './targets.ts';

const CWD = '/tmp/starling-release-cli-test';
const HOST = TARGETS[0];

describe('parseBuildArgs', () => {
  test('defaults to the host target and tools/release/dist', () => {
    const args = parseBuildArgs([], { cwd: CWD, host: HOST });
    expect(args.version).toBeUndefined();
    expect(args.targets).toEqual([HOST]);
    expect(args.outDir).toBe(join(CWD, 'tools/release/dist'));
    expect(args.skipWeb).toBe(false);
  });

  test('reads --version and leaves undefined when absent', () => {
    expect(parseBuildArgs(['--version', '0.1.0'], { cwd: CWD, host: HOST }).version).toBe('0.1.0');
    expect(parseBuildArgs(['--version=0.2.0'], { cwd: CWD, host: HOST }).version).toBe('0.2.0');
  });

  test('--target all selects every target', () => {
    expect(parseBuildArgs(['--target', 'all'], { cwd: CWD, host: HOST }).targets).toEqual([...TARGETS]);
  });

  test('--target <os-arch> selects exactly one target', () => {
    expect(parseBuildArgs(['--target', 'linux-x64'], { cwd: CWD, host: HOST }).targets).toEqual([TARGETS[2]]);
    expect(parseBuildArgs(['--target', 'darwin-x64'], { cwd: CWD, host: HOST }).targets).toEqual([
      TARGETS[1],
    ]);
  });

  test('rejects an unknown --target with the supported list', () => {
    expect(() => parseBuildArgs(['--target', 'windows-x64'], { cwd: CWD, host: HOST })).toThrow(
      /Unknown release target "windows-x64"/,
    );
  });

  test('--out resolves relative to the working directory', () => {
    expect(parseBuildArgs(['--out', 'out'], { cwd: CWD, host: HOST }).outDir).toBe(resolve(CWD, 'out'));
    expect(parseBuildArgs(['--out', '/tmp/abs'], { cwd: CWD, host: HOST }).outDir).toBe('/tmp/abs');
  });

  test('--skip-web is a boolean', () => {
    expect(parseBuildArgs(['--skip-web'], { cwd: CWD, host: HOST }).skipWeb).toBe(true);
  });

  test('an option without a value is an error', () => {
    expect(() => parseBuildArgs(['--version'], { cwd: CWD, host: HOST })).toThrow(/--version needs a value/);
    expect(() => parseBuildArgs(['--target'], { cwd: CWD, host: HOST })).toThrow(/--target needs a value/);
    expect(() => parseBuildArgs(['--target', '--skip-web'], { cwd: CWD, host: HOST })).toThrow(
      /--target needs a value/,
    );
    expect(() => parseBuildArgs(['--out='], { cwd: CWD, host: HOST })).toThrow(/--out needs a value/);
  });

  test('an unknown argument is an error, not silently ignored', () => {
    expect(() => parseBuildArgs(['--verbose'], { cwd: CWD, host: HOST })).toThrow(/Unknown argument/);
  });

  test('the help text documents the asset-affecting flags', () => {
    expect(USAGE).toContain('--target <spec>');
    expect(USAGE).toContain('--version <v>');
    expect(USAGE).toContain('--skip-web');
    expect(USAGE).toContain('Nothing is published');
  });
});

describe('parseDryRunArgs', () => {
  test('defaults: no version, builds the web app, removes the temp dirs', () => {
    expect(parseDryRunArgs([])).toEqual({ version: undefined, skipWeb: false, keep: false });
  });

  test('reads --version in both spellings', () => {
    expect(parseDryRunArgs(['--version', '0.3.0']).version).toBe('0.3.0');
    expect(parseDryRunArgs(['--version=0.3.0']).version).toBe('0.3.0');
  });

  test('reads --skip-web and --keep', () => {
    expect(parseDryRunArgs(['--skip-web', '--keep'])).toEqual({
      version: undefined,
      skipWeb: true,
      keep: true,
    });
  });

  test('rejects a missing value and an unknown flag', () => {
    expect(() => parseDryRunArgs(['--version'])).toThrow(/needs a value/);
    expect(() => parseDryRunArgs(['--version', '--keep'])).toThrow(/needs a value/);
    expect(() => parseDryRunArgs(['--fast'])).toThrow(/Unknown argument/);
  });

  test('the help text says nothing is published', () => {
    expect(DRY_RUN_USAGE).toContain('Publishes nothing');
  });
});
