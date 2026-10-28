/**
 * Tarball argv. The important part is that GNU-only flags never reach bsdtar: on macOS that is a
 * hard error, and a release script that only works on Linux is not a release script.
 */
import { describe, expect, test } from 'bun:test';
import type { ExecFn } from './exec.ts';
import { detectTarFlavor, GNU_DETERMINISTIC_FLAGS, TAR_ENV, tarCommand } from './tar.ts';

function tarVersion(flavor: string, code = 0): ExecFn {
  return async () => ({ code, stdout: flavor, stderr: '' });
}

describe('detectTarFlavor', () => {
  test('recognises GNU tar', async () => {
    expect(await detectTarFlavor(tarVersion('tar (GNU tar) 1.35\n'), '/tmp')).toBe('gnu');
  });

  test('recognises macOS bsdtar/libarchive', async () => {
    expect(await detectTarFlavor(tarVersion('bsdtar 3.5.3 - libarchive 3.7.4\n'), '/tmp')).toBe('bsd');
  });

  test('falls back to unknown for anything else', async () => {
    expect(await detectTarFlavor(tarVersion('some-other-tar 1.0\n'), '/tmp')).toBe('unknown');
  });

  test('falls back to unknown when tar itself fails', async () => {
    expect(await detectTarFlavor(tarVersion('', 127), '/tmp')).toBe('unknown');
  });
});

describe('tarCommand', () => {
  const input = {
    archivePath: '/tmp/dist/starling-0.1.0-linux-x64.tar.gz',
    stagingParent: '/tmp/dist/.staging',
    topLevelDir: 'starling-0.1.0-linux-x64',
    flavor: 'gnu' as const,
  };

  test('writes the archive from the staging parent', () => {
    expect(tarCommand(input).slice(0, 5)).toEqual([
      'tar',
      '-czf',
      input.archivePath,
      '-C',
      input.stagingParent,
    ]);
  });

  test('archives exactly the single top-level directory', () => {
    expect(tarCommand(input).at(-1)).toBe('starling-0.1.0-linux-x64');
  });

  test('adds the reproducible flags on GNU tar', () => {
    const argv = tarCommand(input);
    for (const flag of GNU_DETERMINISTIC_FLAGS) expect(argv).toContain(flag);
  });

  test('uses plain flags on bsdtar', () => {
    const argv = tarCommand({ ...input, flavor: 'bsd' });
    expect(argv).not.toContain('--sort=name');
    expect(argv).not.toContain('--mtime=@0');
    expect(argv).toContain('-czf');
  });

  test('uses plain flags when the flavor is unknown', () => {
    expect(tarCommand({ ...input, flavor: 'unknown' })).not.toContain('--owner=0');
  });

  test('COPYFILE_DISABLE keeps macOS AppleDouble files out of the tarball', () => {
    expect(TAR_ENV.COPYFILE_DISABLE).toBe('1');
  });
});
