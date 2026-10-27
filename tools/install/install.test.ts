/**
 * install.test.ts — the installer, end to end, against a fake release host on loopback.
 *
 * Every case runs the real `sh tools/install/install.sh` with a throwaway HOME, TMPDIR and install
 * directory, and a `STARLING_RELEASE_BASE_URL` pointing at a `Bun.serve` fake (the harness refuses
 * anything but loopback). Assertions are on observable behaviour: exit codes, one-line errors,
 * what landed on disk, which URLs were fetched, and the rc file's exact contents.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type FakeRelease, type FakeReleaseOptions, startFakeRelease } from './fake-release';
import { assetName, type PlatformSpec } from './tarball';
import {
  BASE_TOOLS,
  checksumTool,
  cleanupSandbox,
  makeSandbox,
  OFFLINE_BASE_URL,
  runInstaller,
  type Sandbox,
  toolchain,
  wgetShim,
} from './test-harness';

const DARWIN_ARM: PlatformSpec = { os: 'darwin', arch: 'arm64' };
const DARWIN_X64: PlatformSpec = { os: 'darwin', arch: 'x64' };
const LINUX_X64: PlatformSpec = { os: 'linux', arch: 'x64' };

const sandboxes: Sandbox[] = [];
const releases: FakeRelease[] = [];

function sandbox(): Sandbox {
  const next = makeSandbox();
  sandboxes.push(next);
  return next;
}

function release(opts: FakeReleaseOptions): Promise<FakeRelease> {
  const next = startFakeRelease(opts);
  return next.then((fake) => {
    releases.push(fake);
    return fake;
  });
}

/** Fake `uname` for a platform, so a macOS test can stand in for Linux. */
function platformEnv(platform: PlatformSpec, machine?: string): Record<string, string> {
  const unameS = platform.os === 'darwin' ? 'Darwin' : 'Linux';
  const unameM = machine ?? (platform.arch === 'arm64' ? 'aarch64' : 'x86_64');
  return { STARLING_UNAME_S: unameS, STARLING_UNAME_M: unameM };
}

function installedVersion(box: Sandbox): string {
  return readFileSync(join(box.installDir, 'VERSION'), 'utf8').trim();
}

function binarySays(box: Sandbox): string {
  const result = Bun.spawnSync([join(box.installDir, 'bin/starling'), '--version']);
  expect(result.exitCode).toBe(0);
  return result.stdout.toString().trim();
}

afterEach(async () => {
  for (const fake of releases.splice(0)) await fake.stop();
  for (const box of sandboxes.splice(0)) cleanupSandbox(box);
});

describe('happy path', () => {
  for (const platform of [DARWIN_ARM, DARWIN_X64, LINUX_X64]) {
    test(`installs ${platform.os}-${platform.arch}`, async () => {
      const box = sandbox();
      const fake = await release({ version: '1.0.0' });
      const result = await runInstaller(box, {
        releaseBaseUrl: fake.baseUrl,
        env: platformEnv(platform),
      });

      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      expect(installedVersion(box)).toBe('1.0.0');
      expect(binarySays(box)).toBe('starling 1.0.0');
      expect(existsSync(join(box.installDir, 'share/starling/web/index.html'))).toBe(true);
      expect(readFileSync(join(box.installDir, 'share/starling/web/index.html'), 'utf8')).toContain(
        'Starling 1.0.0',
      );
      expect(statSync(join(box.installDir, 'bin/starling')).mode & 0o111).not.toBe(0);
      expect(result.stdout).toContain('Verified SHA-256');
      expect(result.stdout).toContain('🐦 Starling 1.0.0 is installed');
      expect(result.stdout).toContain('starling try');
      expect(result.stdout).toContain('starling doctor');

      // The temp dir is gone: the EXIT trap ran.
      expect(readdirSync(box.tmp)).toEqual([]);
    });
  }

  test('defaults the install directory to ~/.starling', async () => {
    const box = sandbox();
    const fake = await release({ version: '2.0.0' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: { ...platformEnv(DARWIN_ARM), STARLING_INSTALL_DIR: undefined },
    });

    expect(result.code).toBe(0);
    expect(existsSync(join(box.home, '.starling/bin/starling'))).toBe(true);
    expect(readFileSync(join(box.home, '.starling/VERSION'), 'utf8').trim()).toBe('2.0.0');
  });

  test('--dir overrides STARLING_INSTALL_DIR', async () => {
    const box = sandbox();
    const custom = join(box.dir, 'custom-install');
    const fake = await release({ version: '1.0.0' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: platformEnv(DARWIN_ARM),
      args: ['--dir', custom],
    });

    expect(result.code).toBe(0);
    expect(existsSync(join(custom, 'bin/starling'))).toBe(true);
    expect(existsSync(box.installDir)).toBe(false);
  });

  test('--quiet prints nothing on success', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: platformEnv(DARWIN_ARM),
      args: ['--quiet'],
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(installedVersion(box)).toBe('1.0.0');
  });
});

describe('release URLs', () => {
  test('latest fetches the manifest and asset from latest/download', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.4.2' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: platformEnv(DARWIN_ARM),
    });

    expect(result.code).toBe(0);
    expect(fake.requests).toEqual([
      '/latest/download/SHA256SUMS',
      `/latest/download/${assetName('1.4.2', DARWIN_ARM)}`,
    ]);
  });

  test('a pinned version fetches from download/v<version>', async () => {
    const box = sandbox();
    const fake = await release({ version: '3.1.4' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: platformEnv(LINUX_X64),
      args: ['--version', '3.1.4'],
    });

    expect(result.code).toBe(0);
    expect(fake.requests).toEqual([
      '/download/v3.1.4/SHA256SUMS',
      `/download/v3.1.4/${assetName('3.1.4', LINUX_X64)}`,
    ]);
    expect(installedVersion(box)).toBe('3.1.4');
  });

  test('a leading v in --version is accepted', async () => {
    const box = sandbox();
    const fake = await release({ version: '3.1.4' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: platformEnv(DARWIN_ARM),
      args: ['--version=v3.1.4'],
    });

    expect(result.code).toBe(0);
    expect(fake.requests[0]).toBe('/download/v3.1.4/SHA256SUMS');
  });

  test('an unknown pinned version fails before installing anything', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: platformEnv(DARWIN_ARM),
      args: ['--version', '9.9.9'],
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('could not download SHA256SUMS');
    expect(fake.requests).toEqual(['/download/v9.9.9/SHA256SUMS']);
    expect(existsSync(box.installDir)).toBe(false);
  });
});

describe('verification', () => {
  test('rejects a checksum mismatch and installs nothing', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0', corrupt: 'checksum' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: platformEnv(DARWIN_ARM),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('checksum mismatch');
    expect(result.stderr).toContain('nothing was written');
    expect(existsSync(box.installDir)).toBe(false);
    expect(readdirSync(box.tmp)).toEqual([]);
  });

  test('rejects an archive whose bytes were altered in transit', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0', corrupt: 'payload' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: platformEnv(DARWIN_ARM),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('checksum mismatch');
    expect(existsSync(join(box.installDir, 'bin/starling'))).toBe(false);
  });

  test('refuses when SHA256SUMS has no line for the asset', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0', omitSumsFor: DARWIN_ARM });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: platformEnv(DARWIN_ARM),
      args: ['--version', '1.0.0'],
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no entry');
    expect(existsSync(box.installDir)).toBe(false);
  });

  test('refuses when SHA256SUMS is missing', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0', omitSums: true });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: platformEnv(DARWIN_ARM),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('could not download SHA256SUMS');
    expect(existsSync(box.installDir)).toBe(false);
  });

  test('refuses to install without a SHA-256 tool', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const path = toolchain(box.dir, BASE_TOOLS);
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: { ...platformEnv(DARWIN_ARM), PATH: path },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('no SHA-256 tool');
    expect(existsSync(box.installDir)).toBe(false);
    expect(fake.requests).toEqual([]);
  });

  test('STARLING_INSECURE_SKIP_VERIFY=1 installs with a loud warning', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const path = toolchain(box.dir, BASE_TOOLS);
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: {
        ...platformEnv(DARWIN_ARM),
        PATH: path,
        STARLING_INSECURE_SKIP_VERIFY: '1',
      },
    });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain('WARNING');
    expect(result.stderr).toContain('DISABLED');
    expect(installedVersion(box)).toBe('1.0.0');
  });

  test('uses shasum when sha256sum is absent', async () => {
    if (!Bun.which('shasum')) {
      expect(Bun.which('shasum')).toBeNull();
      return;
    }
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const path = toolchain(box.dir, [...BASE_TOOLS, 'shasum']);
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: { ...platformEnv(DARWIN_ARM), PATH: path },
    });

    expect(result.code).toBe(0);
    expect(installedVersion(box)).toBe('1.0.0');
  });

  test('downloads with wget when curl is absent', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const names = [...BASE_TOOLS.filter((name) => name !== 'curl'), checksumTool() ?? 'shasum'];
    const tools = toolchain(box.dir, names);
    const path = `${wgetShim(box.dir)}:${tools}`;
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: { ...platformEnv(DARWIN_ARM), PATH: path },
    });

    expect(result.code).toBe(0);
    expect(fake.requests).toContain(`/latest/download/${assetName('1.0.0', DARWIN_ARM)}`);
    expect(installedVersion(box)).toBe('1.0.0');
  });

  test('explains a missing downloader', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const names = [...BASE_TOOLS.filter((name) => name !== 'curl'), checksumTool() ?? 'shasum'];
    const path = toolchain(box.dir, names);
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: { ...platformEnv(DARWIN_ARM), PATH: path },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('need curl or wget');
  });
});

describe('unsupported platforms', () => {
  test('names the supported matrix for linux-arm64', async () => {
    const box = sandbox();
    const result = await runInstaller(box, {
      releaseBaseUrl: OFFLINE_BASE_URL,
      env: { STARLING_UNAME_S: 'Linux', STARLING_UNAME_M: 'aarch64' },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unsupported platform');
    expect(result.stderr).toContain('darwin-arm64');
    expect(result.stderr).toContain('linux-x64');
    expect(result.stderr).toContain('build-from-source');
  });

  test('refuses an unknown operating system', async () => {
    const box = sandbox();
    const result = await runInstaller(box, {
      releaseBaseUrl: OFFLINE_BASE_URL,
      env: { STARLING_UNAME_S: 'FreeBSD', STARLING_UNAME_M: 'x86_64' },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unsupported operating system');
    expect(result.stderr).toContain('FreeBSD');
  });

  test('refuses an unknown architecture', async () => {
    const box = sandbox();
    const result = await runInstaller(box, {
      releaseBaseUrl: OFFLINE_BASE_URL,
      env: { STARLING_UNAME_S: 'Linux', STARLING_UNAME_M: 'riscv64' },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unsupported architecture');
    expect(result.stderr).toContain('riscv64');
  });
});

describe('idempotency and upgrades', () => {
  test('a pinned re-run is a no-op and makes no request', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const env = { ...platformEnv(DARWIN_ARM), STARLING_VERSION: '1.0.0' };
    const first = await runInstaller(box, { releaseBaseUrl: fake.baseUrl, env });
    expect(first.code).toBe(0);

    const requestsAfterInstall = fake.requests.length;
    const second = await runInstaller(box, { releaseBaseUrl: fake.baseUrl, env });

    expect(second.code).toBe(0);
    expect(second.stdout).toContain('already installed');
    expect(fake.requests.length).toBe(requestsAfterInstall);
  });

  test('a latest re-run only refreshes the manifest', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const env = platformEnv(DARWIN_ARM);
    expect((await runInstaller(box, { releaseBaseUrl: fake.baseUrl, env })).code).toBe(0);

    fake.requests.length = 0;
    const second = await runInstaller(box, { releaseBaseUrl: fake.baseUrl, env });

    expect(second.code).toBe(0);
    expect(second.stdout).toContain('already installed');
    expect(fake.requests).toEqual(['/latest/download/SHA256SUMS']);
  });

  test('a newer version upgrades in place', async () => {
    const box = sandbox();
    const env = platformEnv(DARWIN_ARM);
    const old = await release({ version: '1.0.0' });
    expect((await runInstaller(box, { releaseBaseUrl: old.baseUrl, env })).code).toBe(0);

    const fresh = await release({ version: '1.1.0' });
    const upgrade = await runInstaller(box, { releaseBaseUrl: fresh.baseUrl, env });

    expect(upgrade.code).toBe(0);
    expect(installedVersion(box)).toBe('1.1.0');
    expect(binarySays(box)).toBe('starling 1.1.0');
    expect(readFileSync(join(box.installDir, 'share/starling/web/index.html'), 'utf8')).toContain(
      'Starling 1.1.0',
    );
  });
});

describe('PATH', () => {
  test('prints a zsh line and does not touch ~/.zshrc by default', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: { ...platformEnv(DARWIN_ARM), SHELL: '/bin/zsh' },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`export PATH="${box.installDir}/bin:$PATH"`);
    expect(result.stdout).toContain(join(box.home, '.zshrc'));
    expect(existsSync(join(box.home, '.zshrc'))).toBe(false);
  });

  test('uses ~/.bash_profile for bash on macOS', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: { ...platformEnv(DARWIN_ARM), SHELL: '/bin/bash' },
    });

    expect(result.stdout).toContain(join(box.home, '.bash_profile'));
  });

  test('uses ~/.bashrc for bash on Linux', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: { ...platformEnv(LINUX_X64), SHELL: '/usr/bin/bash' },
    });

    expect(result.stdout).toContain(join(box.home, '.bashrc'));
  });

  test('suggests fish_add_path for fish', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: { ...platformEnv(DARWIN_ARM), SHELL: '/opt/homebrew/bin/fish' },
    });

    expect(result.stdout).toContain(`fish_add_path ${box.installDir}/bin`);
    expect(result.stdout).toContain(join(box.home, '.config/fish/config.fish'));
  });

  test('says nothing about PATH when the bin dir is already on it', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: {
        ...platformEnv(DARWIN_ARM),
        PATH: `${box.installDir}/bin:${process.env.PATH ?? ''}`,
      },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('export PATH=');
    expect(result.stdout).not.toContain('fish_add_path');
  });

  test('--modify-path writes the marker exactly once, even across upgrades', async () => {
    const box = sandbox();
    const env = platformEnv(DARWIN_ARM);
    const first = await release({ version: '1.0.0' });
    expect(
      (await runInstaller(box, { releaseBaseUrl: first.baseUrl, env, args: ['--modify-path'] })).code,
    ).toBe(0);

    const rcPath = join(box.home, '.zshrc');
    const once = readFileSync(rcPath, 'utf8');
    expect(once.trim()).toBe(`export PATH="${box.installDir}/bin:$PATH"  # added by starling installer`);

    const second = await release({ version: '1.1.0' });
    const again = await runInstaller(box, { releaseBaseUrl: second.baseUrl, env, args: ['--modify-path'] });

    expect(again.code).toBe(0);
    expect(again.stdout).toContain('already adds Starling to PATH');
    const twice = readFileSync(rcPath, 'utf8');
    expect(twice.split('# added by starling installer').length - 1).toBe(1);
  });

  test('--modify-path creates the fish config directory', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: { ...platformEnv(DARWIN_ARM), SHELL: '/opt/homebrew/bin/fish' },
      args: ['--modify-path'],
    });

    expect(result.code).toBe(0);
    const config = readFileSync(join(box.home, '.config/fish/config.fish'), 'utf8');
    expect(config).toContain(`fish_add_path ${box.installDir}/bin`);
    expect(config).toContain('# added by starling installer');
  });

  test('STARLING_NO_MODIFY_PATH=1 refuses to edit rc files', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.0.0' });
    const result = await runInstaller(box, {
      releaseBaseUrl: fake.baseUrl,
      env: { ...platformEnv(DARWIN_ARM), STARLING_NO_MODIFY_PATH: '1' },
      args: ['--modify-path'],
    });

    expect(result.code).toBe(0);
    expect(existsSync(join(box.home, '.zshrc'))).toBe(false);
    expect(result.stdout).toContain('Add Starling to your PATH');
  });
});

describe('flags', () => {
  test('--help exits 0 with usage', async () => {
    const box = sandbox();
    const result = await runInstaller(box, { releaseBaseUrl: OFFLINE_BASE_URL, args: ['--help'] });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: install.sh');
    expect(result.stdout).toContain('STARLING_INSTALL_DIR');
  });

  test('an unknown flag exits 2 with usage on stderr', async () => {
    const box = sandbox();
    const result = await runInstaller(box, { releaseBaseUrl: OFFLINE_BASE_URL, args: ['--nope'] });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('unknown option --nope');
    expect(result.stderr).toContain('Usage: install.sh');
  });

  test('--version without a value exits 1 with a hint', async () => {
    const box = sandbox();
    const result = await runInstaller(box, { releaseBaseUrl: OFFLINE_BASE_URL, args: ['--version'] });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('--version needs a value');
  });

  test('rejects a version that is not a plain version string', async () => {
    const box = sandbox();
    const result = await runInstaller(box, {
      releaseBaseUrl: OFFLINE_BASE_URL,
      args: ['--version', '../evil'],
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('invalid version');
  });
});

describe('fake release host', () => {
  test('serves only the platforms it was given', async () => {
    const only = await startFakeRelease({ version: '1.0.0', platforms: [DARWIN_ARM] });
    releases.push(only);
    const missing = await fetch(`${only.baseUrl}/latest/download/${assetName('1.0.0', LINUX_X64)}`);
    expect(missing.status).toBe(404);
    const unknownVersion = await fetch(`${only.baseUrl}/download/v7.0.0/SHA256SUMS`);
    expect(unknownVersion.status).toBe(404);
  });

  test('serves a tarball in the Epic 151 layout and a well-formed SHA256SUMS line', async () => {
    const box = sandbox();
    const fake = await release({ version: '1.5.0' });
    const asset = assetName('1.5.0', DARWIN_ARM);

    const sums = await (await fetch(`${fake.baseUrl}/latest/download/SHA256SUMS`)).text();
    expect(sums).toMatch(new RegExp(`^[0-9a-f]{64}  ${asset.replace(/\./g, '\\.')}$`, 'm'));

    const bytes = new Uint8Array(
      await (await fetch(`${fake.baseUrl}/latest/download/${asset}`)).arrayBuffer(),
    );
    const tarball = join(box.dir, asset);
    writeFileSync(tarball, bytes);
    const unpack = join(box.dir, 'unpack');
    mkdirSync(unpack);
    const tar = Bun.spawnSync(['tar', '-xzf', tarball, '-C', unpack]);
    expect(tar.exitCode).toBe(0);

    const top = `starling-1.5.0-darwin-arm64`;
    expect(existsSync(join(unpack, top, 'bin/starling'))).toBe(true);
    expect(existsSync(join(unpack, top, 'share/starling/web/index.html'))).toBe(true);
  });
});
