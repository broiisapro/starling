/**
 * `bun tools/release/build.ts` — build the release artefacts, never publish them.
 *
 * One command produces, in `--out` (default `tools/release/dist`, git-ignored):
 *   starling-<version>-<os>-<arch>.tar.gz   the compiled CLI + the built dashboard + license/readme
 *   SHA256SUMS                              `<64 hex>  <name>`, sorted by name
 *   manifest.json                           version, commit, builtAt, assets
 *   starling.rb                             the Homebrew formula rendered from the assets
 *
 * The dashboard is built once; each target then gets one `bun build --compile`. Compiling a
 * non-host target makes Bun download that target's runtime (network) — that is why the dry run and
 * the unit tests only ever build the host, and why `--target all` is documented as a manual step.
 */
import { stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { StarlingError } from '../../packages/core/src/index.ts';
import { formatChecksums, sha256File } from './checksums.ts';
import type { CommandResult, ExecFn } from './exec.ts';
import { mustExec, runCommand } from './exec.ts';
import { isCompleteFormula, renderFormula } from './formula.ts';
import { copyDir, copyFileInto, ensureDir, pathExists, removeDir } from './fs-util.ts';
import { formatBytes } from './report.ts';
import { detectTarFlavor, TAR_ENV, tarCommand } from './tar.ts';
import {
  assetName,
  hostTarget,
  normalizeVersion,
  parseTargetId,
  TARGETS,
  type Target,
  type TargetArch,
  type TargetOs,
  targetId,
  topLevelDir,
} from './targets.ts';
import { DEFAULT_REPO_ROOT, resolveVersion } from './version.ts';

export const DEFAULT_OUT_DIR = 'tools/release/dist';
export const CLI_ENTRY = 'apps/cli/src/index.ts';
export const WEB_BUILD_COMMAND: readonly string[] = ['bun', 'run', '--cwd', 'apps/web', 'build'];

export interface ReleaseAsset {
  name: string;
  os: TargetOs;
  arch: TargetArch;
  bytes: number;
  sha256: string;
}

export interface ReleaseManifest {
  version: string;
  /** Short git sha of the tree the assets were built from (`unknown` outside a git checkout). */
  commit: string;
  /** ISO-8601 UTC. */
  builtAt: string;
  assets: ReleaseAsset[];
}

export interface BuildReleaseOptions {
  version: string;
  /** Defaults to every target in `TARGETS`; pass `[hostTarget()]` for a fast local build. */
  targets?: readonly Target[];
  outDir: string;
  /** Defaults to `<repoRoot>/apps/web/dist`. */
  webDist?: string;
  repoRoot?: string;
  exec?: ExecFn;
  skipWebBuild?: boolean;
  /** Skips `git rev-parse`; used by tests. */
  commit?: string;
  /** Epoch ms for `builtAt`; used by tests. */
  builtAt?: number;
  /** Formula template text; defaults to the packaged `.tmpl`. */
  template?: string;
  log?: (message: string) => void;
}

/**
 * The exact `bun build --compile` argv for one target.
 *
 * `--define process.env.STARLING_VERSION` bakes the release version into the binary; Epic 145's
 * `starling version` reads it, and Epic 203 can point `program.version()` at it (FIX REQUEST).
 */
export function compileCommand(input: {
  version: string;
  target: Target;
  entry: string;
  outfile: string;
}): string[] {
  return [
    'bun',
    'build',
    '--compile',
    '--minify',
    '--sourcemap=none',
    `--target=${input.target.bunTarget}`,
    '--define',
    `process.env.STARLING_VERSION="${input.version}"`,
    input.entry,
    '--outfile',
    input.outfile,
  ];
}

async function resolveCommit(exec: ExecFn, cwd: string): Promise<string> {
  let result: CommandResult;
  try {
    result = await exec(['git', 'rev-parse', '--short', 'HEAD'], { cwd });
  } catch {
    return 'unknown';
  }
  const sha = result.stdout.trim();
  return result.code === 0 && sha !== '' ? sha : 'unknown';
}

async function assertWebDist(webDist: string): Promise<void> {
  if (!(await pathExists(join(webDist, 'index.html')))) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `No dashboard build at ${webDist} (missing index.html). Run \`bun run --cwd apps/web build\` or drop --skip-web.`,
    );
  }
}

/**
 * Build every requested target. Pure orchestration over `exec` + the filesystem, so a fake `exec`
 * (which writes placeholder files) exercises the whole flow in unit tests without a compiler.
 */
export async function buildRelease(options: BuildReleaseOptions): Promise<ReleaseManifest> {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const exec = options.exec ?? runCommand;
  const log = options.log ?? (() => {});
  const version = normalizeVersion(options.version);
  const targets = options.targets ?? TARGETS;
  const outDir = resolve(options.outDir);
  const webDist = resolve(options.webDist ?? join(repoRoot, 'apps/web/dist'));
  const stagingParent = join(outDir, '.staging');

  await ensureDir(outDir);

  if (options.skipWebBuild === true) {
    await assertWebDist(webDist);
    log(`using the existing dashboard build in ${webDist}`);
  } else {
    log('building the dashboard (apps/web)');
    await mustExec(exec, [...WEB_BUILD_COMMAND], repoRoot);
    await assertWebDist(webDist);
  }

  const commit = options.commit ?? (await resolveCommit(exec, repoRoot));
  const builtAt = new Date(options.builtAt ?? Date.now()).toISOString();
  const flavor = await detectTarFlavor(exec, repoRoot);
  log(`tar flavor: ${flavor}`);

  const assets: ReleaseAsset[] = [];
  for (const target of targets) {
    const id = targetId(target);
    const name = assetName(version, target);
    const top = topLevelDir(version, target);
    log(`building ${id} (${target.bunTarget}) → ${name}`);

    await removeDir(stagingParent);
    const staging = join(stagingParent, top);
    const outfile = join(staging, 'bin', 'starling');
    await ensureDir(join(staging, 'bin'));
    await ensureDir(join(staging, 'share', 'starling', 'web'));

    await mustExec(
      exec,
      compileCommand({
        version,
        target,
        entry: join(repoRoot, CLI_ENTRY),
        outfile,
      }),
      repoRoot,
    );
    if (!(await pathExists(outfile))) {
      throw new StarlingError('EXEC_FAILED', `bun build succeeded but did not write ${outfile}`);
    }

    await copyDir(webDist, join(staging, 'share', 'starling', 'web'));
    await copyFileInto(join(repoRoot, 'LICENSE'), join(staging, 'LICENSE'));
    await copyFileInto(join(repoRoot, 'README.md'), join(staging, 'README.md'));

    const archivePath = join(outDir, name);
    await mustExec(
      exec,
      tarCommand({ archivePath, stagingParent, topLevelDir: top, flavor }),
      stagingParent,
      TAR_ENV,
    );
    const sha256 = await sha256File(archivePath);
    const bytes = (await stat(archivePath)).size;
    assets.push({ name, os: target.os, arch: target.arch, bytes, sha256 });

    await removeDir(stagingParent);
    log(`  ${name}  ${formatBytes(bytes)}  ${sha256.slice(0, 12)}…`);
  }
  await removeDir(stagingParent);

  assets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  await writeFile(join(outDir, 'SHA256SUMS'), formatChecksums(assets), 'utf8');
  const manifest: ReleaseManifest = { version, commit, builtAt, assets };
  await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(
    join(outDir, 'starling.rb'),
    renderFormula({ version, assets, template: options.template }),
    'utf8',
  );
  if (!isCompleteFormula(assets)) {
    log(
      `formula is partial (${assets.length}/${TARGETS.length} targets); render a publishable one with --target all`,
    );
  }

  return manifest;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export interface BuildCliArgs {
  /** Undefined means "read the root package.json". */
  version?: string;
  targets: readonly Target[];
  outDir: string;
  skipWeb: boolean;
}

export const USAGE = `Usage: bun tools/release/build.ts [options]

  --version <v>        release version (default: the root package.json version)
  --target <spec>      host (default) | all | darwin-arm64 | darwin-x64 | linux-x64
  --out <dir>          output directory (default: ${DEFAULT_OUT_DIR})
  --skip-web           reuse apps/web/dist instead of building the dashboard
  -h, --help           print this help

Nothing is published. Upload the files by hand (see tools/release/README.md).`;

function readOption(argv: readonly string[], index: number, flag: string): { value: string; next: number } {
  const inline = argv[index] ?? '';
  const equals = inline.indexOf('=');
  if (equals !== -1) {
    const value = inline.slice(equals + 1);
    if (value === '') throw new StarlingError('INVALID_ARGUMENT', `${flag} needs a value`);
    return { value, next: index };
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new StarlingError('INVALID_ARGUMENT', `${flag} needs a value`);
  }
  return { value, next: index + 1 };
}

/**
 * Parse the build CLI. Exported and pure so the flag matrix (`host` / `all` / `os-arch` and the
 * "missing value" errors) is tested without spawning anything.
 */
export function parseBuildArgs(
  argv: readonly string[],
  options: { cwd?: string; host?: Target } = {},
): BuildCliArgs {
  const cwd = resolve(options.cwd ?? DEFAULT_REPO_ROOT);
  let version: string | undefined;
  let targetSpec = 'host';
  let outDir = join(cwd, DEFAULT_OUT_DIR);
  let skipWeb = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (flag === '--version') {
      const read = readOption(argv, index, '--version');
      version = read.value;
      index = read.next;
    } else if (flag === '--target') {
      const read = readOption(argv, index, '--target');
      targetSpec = read.value;
      index = read.next;
    } else if (flag === '--out') {
      const read = readOption(argv, index, '--out');
      outDir = resolve(cwd, read.value);
      index = read.next;
    } else if (arg === '--skip-web') {
      skipWeb = true;
    } else {
      throw new StarlingError('INVALID_ARGUMENT', `Unknown argument "${arg}". Try --help.`);
    }
  }

  let targets: readonly Target[];
  if (targetSpec === 'host') {
    targets = [options.host ?? hostTarget()];
  } else if (targetSpec === 'all') {
    targets = [...TARGETS];
  } else {
    targets = [parseTargetId(targetSpec)];
  }
  return { version, targets, outDir, skipWeb };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  try {
    const args = parseBuildArgs(argv);
    const version = await resolveVersion({ flag: args.version });
    const manifest = await buildRelease({
      version,
      targets: args.targets,
      outDir: args.outDir,
      skipWebBuild: args.skipWeb,
      log: (message) => console.log(`release: ${message}`),
    });
    console.log('');
    console.log(`Built ${manifest.assets.length} asset(s) for ${manifest.version} in ${args.outDir}`);
    for (const asset of manifest.assets) {
      console.log(`  ${asset.name}  ${formatBytes(asset.bytes)}  ${asset.sha256}`);
    }
    console.log(`  SHA256SUMS · manifest.json · starling.rb`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`release: ${message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
