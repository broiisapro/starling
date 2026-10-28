/**
 * scripts.test.ts — portability guards for the shell scripts themselves.
 *
 * The installer claims POSIX `sh`: it has to parse under `dash` and macOS `/bin/sh`, and it must
 * not use the bash-only constructs that creep into shell scripts (`[[`, `function`, `local`,
 * `source`, ANSI-C quoting). These checks are cheap and catch the regression that matters most:
 * a contributor testing only in bash.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, statSync } from 'node:fs';

import { startFakeRelease } from './fake-release';
import { cleanupSandbox, INSTALL_SH, makeSandbox, runInstaller, UNINSTALL_SH } from './test-harness';

const SCRIPTS = [
  { name: 'install.sh', path: INSTALL_SH },
  { name: 'uninstall.sh', path: UNINSTALL_SH },
];

const BASHISMS = ['[[', 'function ', 'local ', 'source ', "$'"];

for (const script of SCRIPTS) {
  describe(script.name, () => {
    test('parses under sh -n', () => {
      const result = Bun.spawnSync(['sh', '-n', script.path]);
      expect(result.stderr.toString()).toBe('');
      expect(result.exitCode).toBe(0);
    });

    test('parses under dash -n', () => {
      const dash = Bun.which('dash');
      if (!dash) {
        expect(dash).toBeNull();
        return;
      }
      const result = Bun.spawnSync([dash, '-n', script.path]);
      expect(result.stderr.toString()).toBe('');
      expect(result.exitCode).toBe(0);
    });

    test('contains no bashisms', () => {
      const text = readFileSync(script.path, 'utf8');
      for (const token of BASHISMS) {
        expect(text.includes(token)).toBe(false);
      }
    });

    test('starts with the POSIX sh shebang and is executable', () => {
      const text = readFileSync(script.path, 'utf8');
      expect(text.startsWith('#!/bin/sh\n')).toBe(true);
      expect(text).toContain('set -eu');
      expect(statSync(script.path).mode & 0o111).not.toBe(0);
    });
  });
}

describe('dash end to end', () => {
  test('installs and verifies under dash', async () => {
    const dash = Bun.which('dash');
    if (!dash) {
      expect(dash).toBeNull();
      return;
    }
    const box = makeSandbox();
    const fake = await startFakeRelease({ version: '1.0.0' });
    try {
      const result = await runInstaller(box, {
        releaseBaseUrl: fake.baseUrl,
        env: { STARLING_UNAME_S: 'Darwin', STARLING_UNAME_M: 'arm64', SHELL: '/bin/zsh' },
        shell: dash,
      });
      expect(result.code).toBe(0);
      expect(readFileSync(`${box.installDir}/VERSION`, 'utf8').trim()).toBe('1.0.0');
    } finally {
      await fake.stop();
      cleanupSandbox(box);
    }
  });
});
