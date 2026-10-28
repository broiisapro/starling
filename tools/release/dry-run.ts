/**
 * `bun tools/release/dry-run.ts` — prove the host release end to end, without publishing anything.
 *
 * Steps: build the dashboard, compile the host binary into a temp `dist/`, verify `SHA256SUMS`,
 * unpack the tarball into a second temp dir, run `bin/starling --version|--help|replay`, check the
 * dashboard shipped under `share/starling/web/`, and render the Homebrew formula. Every step prints
 * ✓ or ✗ with its size; any ✗ makes the process exit non-zero.
 *
 * Only the host target is built: cross-compiling makes Bun download another runtime (network), which
 * a smoke test must never need. Use `build.ts --target all` for the real release.
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { StarlingError } from '../../packages/core/src/index.ts';
import type { ReleaseAsset, ReleaseManifest } from './build.ts';
import { buildRelease } from './build.ts';
import { parseChecksums, verifyChecksums } from './checksums.ts';
import type { ExecFn } from './exec.ts';
import { runCommand } from './exec.ts';
import { ensureDir, pathExists, removeDir } from './fs-util.ts';
import { type ChecklistItem, checklistExitCode, formatBytes, renderChecklist } from './report.ts';
import { TAR_ENV } from './tar.ts';
import { assetName, hostTarget, targetId, topLevelDir } from './targets.ts';
import { DEFAULT_REPO_ROOT, resolveVersion } from './version.ts';

export const REPLAY_FIXTURE = 'fixtures/runs/sky-todo-launch-day.jsonl';

export interface DryRunOptions {
  /** Defaults to the root package.json version, like `build.ts`. */
  version?: string;
  /** Reuse `apps/web/dist` instead of running the Vite build. */
  skipWebBuild?: boolean;
  /** Keep the temp dirs for inspection (prints the path). */
  keep?: boolean;
  repoRoot?: string;
  exec?: ExecFn;
  /** Line sink; defaults to stdout. */
  write?: (line: string) => void;
}

export interface DryRunResult {
  ok: boolean;
  exitCode: number;
  items: ChecklistItem[];
  /** Present only when `keep` is true; the temp tree is removed otherwise. */
  tempRoot?: string;
  archivePath?: string;
  /** The `SHA256SUMS` line for the host asset, exactly as written to disk. */
  checksumLine?: string;
}

/** First line of stderr, for a one-line red checklist entry. */
function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function dryRun(options: DryRunOptions = {}): Promise<DryRunResult> {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const exec = options.exec ?? runCommand;
  const write = options.write ?? ((line: string) => console.log(line));
  const version = await resolveVersion({
    flag: options.version,
    packageJsonPath: join(repoRoot, 'package.json'),
  });
  const target = hostTarget();
  const id = targetId(target);
  const items: ChecklistItem[] = [];
  const title = `starling release dry run · v${version} · ${id}`;

  const tempRoot = await mkdtemp(join(tmpdir(), 'starling-release-dryrun-'));
  const distDir = join(tempRoot, 'dist');
  const extractDir = join(tempRoot, 'unpacked');
  const archivePath = join(distDir, assetName(version, target));
  let asset: ReleaseAsset | undefined;
  let checksumLine: string | undefined;

  /** Print the checklist, drop the temp tree unless `keep`, and shape the result. */
  const report = async (): Promise<DryRunResult> => {
    const exitCode = checklistExitCode(items);
    write(renderChecklist(items, title));
    write('');
    if (checksumLine !== undefined) write(`SHA256SUMS  ${checksumLine}`);
    if (asset !== undefined) write(`archive     ${archivePath} (${formatBytes(asset.bytes)})`);
    write(exitCode === 0 ? 'all green — nothing was published' : 'dry run failed — fix the ✗ above');
    if (options.keep === true) {
      write(`kept temp dir ${tempRoot}`);
      return { ok: exitCode === 0, exitCode, items, tempRoot, archivePath, checksumLine };
    }
    await removeDir(tempRoot);
    return { ok: exitCode === 0, exitCode, items, archivePath, checksumLine };
  };

  let manifest: ReleaseManifest;
  try {
    manifest = await buildRelease({
      version,
      targets: [target],
      outDir: distDir,
      repoRoot,
      exec,
      skipWebBuild: options.skipWebBuild,
      log: (message) => write(`  … ${message}`),
    });
  } catch (err) {
    items.push({ label: `build host target (${id})`, ok: false, detail: errorText(err) });
    return report();
  }

  asset = manifest.assets.find((entry) => entry.name === assetName(version, target));
  if (asset === undefined) {
    items.push({
      label: 'asset name matches the installer contract',
      ok: false,
      detail: `manifest has no ${assetName(version, target)}`,
    });
    return report();
  }
  items.push({
    label: 'asset name matches the installer contract',
    ok: true,
    detail: `${asset.name} · ${formatBytes(asset.bytes)}`,
  });

  try {
    const entries = parseChecksums(await readFile(join(distDir, 'SHA256SUMS'), 'utf8'));
    const verified = await verifyChecksums(entries, distDir);
    const line = entries.find((entry) => entry.name === asset.name);
    checksumLine = line === undefined ? undefined : `${line.sha256}  ${line.name}`;
    items.push({
      label: 'SHA256SUMS verifies',
      ok: verified.ok && line !== undefined,
      detail: verified.ok
        ? `${entries.length} asset · ${asset.sha256.slice(0, 12)}…`
        : verified.missing.length > 0
          ? `missing ${verified.missing.join(', ')}`
          : 'checksum mismatch',
    });
  } catch (err) {
    items.push({ label: 'SHA256SUMS verifies', ok: false, detail: errorText(err) });
  }

  await ensureDir(extractDir);
  const unpack = await exec(['tar', '-xzf', archivePath, '-C', extractDir], {
    cwd: tempRoot,
    env: TAR_ENV,
  });
  items.push({
    label: 'tarball extracts',
    ok: unpack.code === 0,
    detail: unpack.code === 0 ? topLevelDir(version, target) : firstLine(unpack.stderr),
  });
  if (unpack.code !== 0) return report();

  const root = join(extractDir, topLevelDir(version, target));
  const bin = join(root, 'bin', 'starling');
  const hasBin = await pathExists(bin);
  items.push({ label: 'bin/starling is present', ok: hasBin });
  const hasWeb = await pathExists(join(root, 'share', 'starling', 'web', 'index.html'));
  items.push({
    label: 'share/starling/web/index.html is present',
    ok: hasWeb,
    detail: 'the path the compiled-binary dashboard fix (FIX REQUEST · Epic 203) expects',
  });
  const hasDocs = (await pathExists(join(root, 'LICENSE'))) && (await pathExists(join(root, 'README.md')));
  items.push({ label: 'LICENSE + README.md are present', ok: hasDocs });

  if (hasBin) {
    const versionRun = await exec([bin, '--version'], { cwd: root });
    items.push({
      label: 'bin/starling --version',
      ok: versionRun.code === 0,
      detail:
        versionRun.code === 0
          ? `prints "${versionRun.stdout.trim()}"`
          : `exit ${versionRun.code} · ${firstLine(versionRun.stderr)}`,
    });
    const helpRun = await exec([bin, '--help'], { cwd: root });
    items.push({
      label: 'bin/starling --help',
      ok: helpRun.code === 0,
      detail: helpRun.code === 0 ? '' : `exit ${helpRun.code} · ${firstLine(helpRun.stderr)}`,
    });
    const replayRun = await exec([bin, 'replay', join(repoRoot, REPLAY_FIXTURE), '--speed', '1000'], {
      cwd: root,
    });
    items.push({
      label: 'bin/starling replay <launch-day fixture>',
      ok: replayRun.code === 0,
      detail:
        replayRun.code === 0
          ? '252 events · exit 0'
          : `exit ${replayRun.code} · ${firstLine(replayRun.stderr)}`,
    });
  }

  try {
    const formula = await readFile(join(distDir, 'starling.rb'), 'utf8');
    const ok =
      formula.includes('class Starling') &&
      !formula.includes('{{') &&
      formula.includes(asset.sha256) &&
      formula.includes('bin.install "bin/starling"') &&
      formula.includes('pkgshare.install "share/starling/web"');
    items.push({
      label: 'formula renders',
      ok,
      detail: ok ? 'starling.rb · sha256 inserted' : 'missing class, sha256 or install lines',
    });
  } catch (err) {
    items.push({ label: 'formula renders', ok: false, detail: errorText(err) });
  }

  return report();
}

// ── CLI ──────────────────────────────────────────────────────────────────────

export const DRY_RUN_USAGE = `Usage: bun tools/release/dry-run.ts [options]

  --version <v>   release version (default: the root package.json version)
  --skip-web      reuse apps/web/dist instead of building the dashboard
  --keep          keep the temp build/unpack dirs and print their path
  -h, --help      print this help

Builds the host target only, verifies the checksum, unpacks it and runs the binary. Publishes nothing.`;

export interface DryRunCliArgs {
  version?: string;
  skipWeb: boolean;
  keep: boolean;
}

export function parseDryRunArgs(argv: readonly string[]): DryRunCliArgs {
  let version: string | undefined;
  let skipWeb = false;
  let keep = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (flag === '--version') {
      const inline = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : undefined;
      const value = inline ?? argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw new StarlingError('INVALID_ARGUMENT', '--version needs a value');
      }
      version = value;
      if (inline === undefined) index += 1;
    } else if (arg === '--skip-web') {
      skipWeb = true;
    } else if (arg === '--keep') {
      keep = true;
    } else {
      throw new StarlingError('INVALID_ARGUMENT', `Unknown argument "${arg}". Try --help.`);
    }
  }
  return { version, skipWeb, keep };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(DRY_RUN_USAGE);
    return 0;
  }
  try {
    const args = parseDryRunArgs(argv);
    const result = await dryRun({ version: args.version, skipWebBuild: args.skipWeb, keep: args.keep });
    return result.exitCode;
  } catch (err) {
    console.error(`dry-run: ${errorText(err)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
