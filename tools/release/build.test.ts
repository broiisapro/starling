/**
 * `buildRelease` orchestration, with an injected `exec` that writes placeholder files instead of
 * compiling anything. That keeps the suite fast (no 85 MB binary, no Bun cross-target download) while
 * still exercising the real staging, copying, hashing, tarball argv, manifest and formula code.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRelease, compileCommand, WEB_BUILD_COMMAND } from './build.ts';
import { formatChecksums, sha256File } from './checksums.ts';
import type { ExecFn } from './exec.ts';
import { pathExists, removeDir } from './fs-util.ts';
import { TARGETS, type Target } from './targets.ts';

const DARWIN_ARM = TARGETS[0];
const DARWIN_X64 = TARGETS[1];
const LINUX_X64 = TARGETS[2];

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => removeDir(dir)));
});

/** A throwaway "repo" with the paths buildRelease copies from. */
async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'starling-release-build-'));
  dirs.push(root);
  await mkdir(join(root, 'apps/web/dist/assets'), { recursive: true });
  await writeFile(join(root, 'apps/web/dist/index.html'), '<!doctype html><title>Sky</title>');
  await writeFile(join(root, 'apps/web/dist/assets/app.js'), 'console.log("sky")');
  await writeFile(join(root, 'apps/web/dist/.DS_Store'), 'finder litter');
  await writeFile(join(root, 'LICENSE'), 'MIT');
  await writeFile(join(root, 'README.md'), '# Starling');
  await mkdir(join(root, 'apps/cli/src'), { recursive: true });
  await writeFile(join(root, 'apps/cli/src/index.ts'), 'console.log("cli")');
  return root;
}

interface FakeOptions {
  tarFlavor?: string;
  compileCode?: number;
  webCode?: number;
  tarCode?: number;
  gitCode?: number;
  /** Report success but write no binary, to prove the guard. */
  noBinary?: boolean;
}

interface FakeExec {
  exec: ExecFn;
  calls: { cmd: string[]; cwd: string }[];
  /** Files present inside the staging top-level dir at `tar` time. */
  staged: string[];
}

async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listFiles(join(root, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
}

function fakeExec(options: FakeOptions = {}): FakeExec {
  const calls: { cmd: string[]; cwd: string }[] = [];
  const staged: string[] = [];
  const exec: ExecFn = async (cmd, opts) => {
    calls.push({ cmd, cwd: opts.cwd });
    if (cmd[0] === 'git') {
      return { code: options.gitCode ?? 0, stdout: 'abc1234\n', stderr: 'not a git repo' };
    }
    if (cmd[0] === 'bun' && cmd[1] === 'run') {
      return { code: options.webCode ?? 0, stdout: '', stderr: 'vite exploded' };
    }
    if (cmd[0] === 'tar' && cmd[1] === '--version') {
      return { code: 0, stdout: options.tarFlavor ?? 'bsdtar 3.5.3 - libarchive 3.7.4', stderr: '' };
    }
    if (cmd[0] === 'bun' && cmd[1] === 'build') {
      if (options.compileCode !== undefined && options.compileCode !== 0) {
        return { code: options.compileCode, stdout: '', stderr: 'compile exploded' };
      }
      if (options.noBinary !== true) {
        const outfile = cmd[cmd.indexOf('--outfile') + 1] ?? '';
        await writeFile(outfile, 'fake-binary');
        await chmod(outfile, 0o755);
      }
      return { code: 0, stdout: '', stderr: '' };
    }
    if (cmd[0] === 'tar' && cmd[1] === '-czf') {
      if (options.tarCode !== undefined && options.tarCode !== 0) {
        return { code: options.tarCode, stdout: '', stderr: 'tar exploded' };
      }
      const archive = cmd[2] ?? '';
      const parent = cmd[cmd.indexOf('-C') + 1] ?? '';
      const top = cmd.at(-1) ?? '';
      staged.push(...(await listFiles(join(parent, top))));
      await writeFile(archive, `fake tarball ${top}`);
      return { code: 0, stdout: '', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { exec, calls, staged };
}

function compileCalls(fake: FakeExec): string[][] {
  return fake.calls.filter(({ cmd }) => cmd[0] === 'bun' && cmd[1] === 'build').map(({ cmd }) => cmd);
}

/** Build one (fake) host asset into `<repo>/dist`. */
async function buildHost(repo: string, fake: FakeExec, version = '0.1.0') {
  return buildRelease({
    version,
    targets: [DARWIN_ARM],
    outDir: join(repo, 'dist'),
    repoRoot: repo,
    exec: fake.exec,
    builtAt: 1_731_000_000_000,
  });
}

describe('buildRelease', () => {
  test('builds the dashboard first, then one compiled binary', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    await buildHost(repo, fake);

    expect(fake.calls[0]?.cmd).toEqual([...WEB_BUILD_COMMAND]);
    expect(fake.calls[0]?.cwd).toBe(repo);
    expect(compileCalls(fake)).toHaveLength(1);
  });

  test('the compile argv is exactly the documented one, including STARLING_VERSION', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    await buildHost(repo, fake);
    expect(compileCalls(fake)[0]).toEqual([
      'bun',
      'build',
      '--compile',
      '--minify',
      '--sourcemap=none',
      '--target=bun-darwin-arm64',
      '--define',
      'process.env.STARLING_VERSION="0.1.0"',
      join(repo, 'apps/cli/src/index.ts'),
      '--outfile',
      join(repo, 'dist/.staging/starling-0.1.0-darwin-arm64/bin/starling'),
    ]);
  });

  test('stages bin/starling, the dashboard, LICENSE and README.md under the top-level dir', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    await buildHost(repo, fake);
    expect(fake.staged).toEqual([
      'LICENSE',
      'README.md',
      'bin/starling',
      'share/starling/web/assets/app.js',
      'share/starling/web/index.html',
    ]);
  });

  test('.DS_Store never reaches the release', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    await buildHost(repo, fake);
    expect(fake.staged.some((file) => file.includes('.DS_Store'))).toBe(false);
  });

  test('writes the tarball, SHA256SUMS, manifest.json and formula into outDir', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    await buildHost(repo, fake);
    for (const file of ['starling-0.1.0-darwin-arm64.tar.gz', 'SHA256SUMS', 'manifest.json', 'starling.rb']) {
      expect(await pathExists(join(repo, 'dist', file))).toBe(true);
    }
  });

  test('the manifest describes the asset and the injected commit/time', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    const manifest = await buildHost(repo, fake);
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.commit).toBe('abc1234');
    expect(manifest.builtAt).toBe(new Date(1_731_000_000_000).toISOString());
    expect(manifest.assets).toHaveLength(1);
    const asset = manifest.assets[0];
    expect(asset?.name).toBe('starling-0.1.0-darwin-arm64.tar.gz');
    expect(asset?.os).toBe('darwin');
    expect(asset?.arch).toBe('arm64');
    expect(asset?.bytes).toBe((await stat(join(repo, 'dist', 'starling-0.1.0-darwin-arm64.tar.gz'))).size);
  });

  test('the recorded sha256 is the real hash of the written tarball', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    const manifest = await buildHost(repo, fake);
    const actual = await sha256File(join(repo, 'dist', 'starling-0.1.0-darwin-arm64.tar.gz'));
    expect(manifest.assets[0]?.sha256).toBe(actual);
  });

  test('SHA256SUMS on disk is exactly formatChecksums(manifest.assets)', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    const manifest = await buildHost(repo, fake);
    expect(await readFile(join(repo, 'dist', 'SHA256SUMS'), 'utf8')).toBe(formatChecksums(manifest.assets));
  });

  test('manifest.json parses back to the returned manifest', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    const manifest = await buildHost(repo, fake);
    const parsed = JSON.parse(await readFile(join(repo, 'dist', 'manifest.json'), 'utf8'));
    expect(parsed).toEqual(manifest);
  });

  test('the formula has the release URL and the asset hash', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    const manifest = await buildHost(repo, fake);
    const formula = await readFile(join(repo, 'dist', 'starling.rb'), 'utf8');
    expect(formula).toContain(
      'https://github.com/broiisapro/starling/releases/download/v0.1.0/starling-0.1.0-darwin-arm64.tar.gz',
    );
    expect(formula).toContain(manifest.assets[0]?.sha256 ?? 'missing');
  });

  test('removes the staging directory when it is done', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    await buildHost(repo, fake);
    expect(await pathExists(join(repo, 'dist', '.staging'))).toBe(false);
  });

  test('--skip-web reuses the existing dist and runs no web build', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    await buildRelease({
      version: '0.1.0',
      targets: [DARWIN_ARM],
      outDir: join(repo, 'dist'),
      repoRoot: repo,
      exec: fake.exec,
      skipWebBuild: true,
    });
    expect(fake.calls.some(({ cmd }) => cmd[0] === 'bun' && cmd[1] === 'run')).toBe(false);
    expect(compileCalls(fake)).toHaveLength(1);
  });

  test('--skip-web without a dashboard build fails with the fix in the message', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    const missing = join(repo, 'dist');
    await expect(
      buildRelease({
        version: '0.1.0',
        targets: [DARWIN_ARM],
        outDir: missing,
        repoRoot: repo,
        exec: fake.exec,
        skipWebBuild: true,
        webDist: join(repo, 'apps/web/nope'),
      }),
    ).rejects.toThrow(/No dashboard build/);
  });

  test('a failing web build stops before compiling', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec({ webCode: 2 });
    await expect(buildHost(repo, fake)).rejects.toThrow(/apps\/web.*failed|failed/);
    expect(compileCalls(fake)).toHaveLength(0);
  });

  test('a failing compile throws EXEC_FAILED with stderr', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec({ compileCode: 1 });
    await expect(buildHost(repo, fake)).rejects.toMatchObject({ code: 'EXEC_FAILED' });
    expect(await pathExists(join(repo, 'dist', 'SHA256SUMS'))).toBe(false);
  });

  test('a "successful" compile that wrote nothing is a failure', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec({ noBinary: true });
    await expect(buildHost(repo, fake)).rejects.toThrow(/did not write/);
  });

  test('a failing tar throws instead of hashing a missing file', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec({ tarCode: 1 });
    await expect(buildHost(repo, fake)).rejects.toThrow(/tar/);
  });

  test('GNU tar gets the reproducible flags, bsdtar does not', async () => {
    const repo = await fixtureRepo();
    const gnu = fakeExec({ tarFlavor: 'tar (GNU tar) 1.35' });
    await buildHost(repo, gnu);
    const gnuTar = gnu.calls.find(({ cmd }) => cmd[0] === 'tar' && cmd[1] === '-czf')?.cmd ?? [];
    expect(gnuTar).toContain('--sort=name');
    expect(gnuTar).toContain('--mtime=@0');

    const bsd = fakeExec();
    await buildHost(repo, bsd);
    const bsdTar = bsd.calls.find(({ cmd }) => cmd[0] === 'tar' && cmd[1] === '-czf')?.cmd ?? [];
    expect(bsdTar).not.toContain('--sort=name');
  });

  test('builds every requested target, sorted by asset name in the manifest', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    const manifest = await buildRelease({
      version: '0.1.0',
      targets: [LINUX_X64, DARWIN_X64, DARWIN_ARM] as readonly Target[],
      outDir: join(repo, 'dist'),
      repoRoot: repo,
      exec: fake.exec,
      skipWebBuild: true,
    });
    expect(manifest.assets.map((asset) => asset.name)).toEqual([
      'starling-0.1.0-darwin-arm64.tar.gz',
      'starling-0.1.0-darwin-x64.tar.gz',
      'starling-0.1.0-linux-x64.tar.gz',
    ]);
    const targets = compileCalls(fake).map((cmd) => cmd.find((arg) => arg.startsWith('--target=')));
    expect(targets).toEqual([
      '--target=bun-linux-x64',
      '--target=bun-darwin-x64',
      '--target=bun-darwin-arm64',
    ]);
    expect((await readFile(join(repo, 'dist', 'SHA256SUMS'), 'utf8')).trim().split('\n')).toHaveLength(3);
  });

  test('falls back to commit "unknown" when git is unavailable', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec({ gitCode: 1 });
    const manifest = await buildHost(repo, fake);
    expect(manifest.commit).toBe('unknown');
  });

  test('honours an injected formula template', async () => {
    const repo = await fixtureRepo();
    const fake = fakeExec();
    await buildRelease({
      version: '0.1.0',
      targets: [DARWIN_ARM],
      outDir: join(repo, 'dist'),
      repoRoot: repo,
      exec: fake.exec,
      skipWebBuild: true,
      template: 'class Starling\n  version "{{VERSION}}"\nend\n',
    });
    expect(await readFile(join(repo, 'dist', 'starling.rb'), 'utf8')).toBe(
      'class Starling\n  version "0.1.0"\nend\n',
    );
  });
});

describe('compileCommand', () => {
  test('maps each target to its Bun runtime name', () => {
    for (const target of TARGETS) {
      const cmd = compileCommand({ version: '1.0.0', target, entry: 'in.ts', outfile: 'out' });
      expect(cmd).toContain(`--target=${target.bunTarget}`);
      expect(cmd).toContain('process.env.STARLING_VERSION="1.0.0"');
    }
  });

  test('compiles minified with no sourcemap (a release is not a debug build)', () => {
    const cmd = compileCommand({ version: '1.0.0', target: DARWIN_ARM, entry: 'in.ts', outfile: 'out' });
    expect(cmd).toContain('--compile');
    expect(cmd).toContain('--minify');
    expect(cmd).toContain('--sourcemap=none');
  });
});
