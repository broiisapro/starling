/**
 * uninstall.test.ts — the uninstaller takes back exactly what the installer wrote.
 *
 * Each case installs a real release from the fake host first, so the assertions are about the
 * installer's own footprint: the CLI, the web build, VERSION, and the marker line in an rc file.
 * User data (`perch/`) must survive unless `--purge` is explicit.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type FakeRelease, type FakeReleaseOptions, startFakeRelease } from './fake-release';
import { cleanupSandbox, makeSandbox, runInstaller, runUninstaller, type Sandbox } from './test-harness';

const sandboxes: Sandbox[] = [];
const releases: FakeRelease[] = [];

function sandbox(): Sandbox {
  const next = makeSandbox();
  sandboxes.push(next);
  return next;
}

function release(opts: FakeReleaseOptions = { version: '1.0.0' }): Promise<FakeRelease> {
  return startFakeRelease(opts).then((fake) => {
    releases.push(fake);
    return fake;
  });
}

const DARWIN_ARM = { STARLING_UNAME_S: 'Darwin', STARLING_UNAME_M: 'arm64', SHELL: '/bin/zsh' };

async function installInto(box: Sandbox, fake: FakeRelease, args: string[] = []): Promise<void> {
  const result = await runInstaller(box, { releaseBaseUrl: fake.baseUrl, env: DARWIN_ARM, args });
  expect(result.code).toBe(0);
}

afterEach(async () => {
  for (const fake of releases.splice(0)) await fake.stop();
  for (const box of sandboxes.splice(0)) cleanupSandbox(box);
});

describe('uninstall', () => {
  test('removes the CLI, the web build and VERSION, but keeps perch data', async () => {
    const box = sandbox();
    await installInto(box, await release());
    mkdirSync(join(box.installDir, 'perch'), { recursive: true });
    writeFileSync(join(box.installDir, 'perch/cache.db'), 'flock state');

    const result = await runUninstaller(box);

    expect(result.code).toBe(0);
    expect(existsSync(join(box.installDir, 'bin/starling'))).toBe(false);
    expect(existsSync(join(box.installDir, 'share/starling'))).toBe(false);
    expect(existsSync(join(box.installDir, 'VERSION'))).toBe(false);
    expect(readFileSync(join(box.installDir, 'perch/cache.db'), 'utf8')).toBe('flock state');
    expect(result.stdout).toContain('Removed');
  });

  test('--purge removes the whole directory, perch data included', async () => {
    const box = sandbox();
    await installInto(box, await release());
    mkdirSync(join(box.installDir, 'perch'), { recursive: true });
    writeFileSync(join(box.installDir, 'perch/cache.db'), 'flock state');

    const result = await runUninstaller(box, { args: ['--purge'] });

    expect(result.code).toBe(0);
    expect(existsSync(box.installDir)).toBe(false);
    expect(result.stdout).toContain('including perch data');
  });

  test('is safe to run twice', async () => {
    const box = sandbox();
    await installInto(box, await release());

    expect((await runUninstaller(box)).code).toBe(0);
    const second = await runUninstaller(box);

    expect(second.code).toBe(0);
    expect(second.stdout).toContain('nothing to remove');
  });

  test('removes only the marker line from rc files and keeps the rest', async () => {
    const box = sandbox();
    const rc = join(box.home, '.zshrc');
    writeFileSync(rc, 'export EDITOR=vim\n');
    await installInto(box, await release(), ['--modify-path']);
    expect(readFileSync(rc, 'utf8')).toContain('# added by starling installer');

    const result = await runUninstaller(box);

    expect(result.code).toBe(0);
    const content = readFileSync(rc, 'utf8');
    expect(content).not.toContain('# added by starling installer');
    expect(content).not.toContain(`${box.installDir}/bin`);
    expect(content).toContain('export EDITOR=vim');
  });

  test('honours --dir instead of STARLING_INSTALL_DIR', async () => {
    const box = sandbox();
    const custom = join(box.dir, 'elsewhere');
    const fake = await release();
    expect(
      (await runInstaller(box, { releaseBaseUrl: fake.baseUrl, env: DARWIN_ARM, args: ['--dir', custom] }))
        .code,
    ).toBe(0);

    const result = await runUninstaller(box, { args: ['--dir', custom] });

    expect(result.code).toBe(0);
    expect(existsSync(join(custom, 'bin/starling'))).toBe(false);
    expect(existsSync(box.installDir)).toBe(false);
  });

  test('--quiet prints nothing', async () => {
    const box = sandbox();
    await installInto(box, await release());

    const result = await runUninstaller(box, { args: ['--quiet'] });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
  });

  test('--help exits 0 and an unknown flag exits 2', async () => {
    const box = sandbox();
    const help = await runUninstaller(box, { args: ['--help'] });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: uninstall.sh');

    const unknown = await runUninstaller(box, { args: ['--bogus'] });
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('unknown option --bogus');
  });

  test('says nothing was removed when Starling is not installed', async () => {
    const box = sandbox();
    const result = await runUninstaller(box);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('nothing to remove');
    expect(existsSync(box.installDir)).toBe(false);
  });
});
