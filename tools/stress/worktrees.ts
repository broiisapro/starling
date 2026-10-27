#!/usr/bin/env bun
/**
 * tools/stress/worktrees.ts — run the swarm-scale worktree stress scenario and print the report.
 *
 *   bun tools/stress/worktrees.ts                       # 5 000 files, 60 worktrees (the real run)
 *   bun tools/stress/worktrees.ts --files 500 --worktrees 12 --pairs 4 --bundles 3
 *   bun tools/stress/worktrees.ts --keep                # leave the repo + worktrees for inspection
 *   bun tools/stress/worktrees.ts --json                # machine-readable report
 *
 * Exit code 1 when anything failed, so it can gate a release or a benchmark comparison.
 */
import { formatBytes } from '../../packages/workspace/src/index.ts';
import { runStress, type StressReport } from './harness.ts';

interface Args {
  files: number;
  worktrees: number;
  pairs: number;
  bundles: number;
  keep: boolean;
  sparse: boolean;
  json: boolean;
  root?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    files: 5000,
    worktrees: 60,
    pairs: 20,
    bundles: 10,
    keep: false,
    sparse: true,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const next = (): number => {
      const raw = argv[index + 1];
      if (raw === undefined) throw new Error(`${arg} needs a value`);
      index += 1;
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value)) throw new Error(`${arg} needs a number, got "${raw}"`);
      return value;
    };
    switch (arg) {
      case '--files':
        args.files = next();
        break;
      case '--worktrees':
        args.worktrees = next();
        break;
      case '--pairs':
        args.pairs = next();
        break;
      case '--bundles':
        args.bundles = next();
        break;
      case '--root':
        args.root = argv[index + 1];
        if (args.root === undefined) throw new Error('--root needs a directory');
        index += 1;
        break;
      case '--keep':
        args.keep = true;
        break;
      case '--no-sparse':
        args.sparse = false;
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        console.log(
          'usage: bun tools/stress/worktrees.ts [--files N] [--worktrees N] [--pairs N] ' +
            '[--bundles N] [--root DIR] [--keep] [--no-sparse] [--json]',
        );
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

const ms = (value: number): string =>
  value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;

/** Render a report as a fixed-width table (pasted verbatim into the handback). */
export function formatReport(report: StressReport): string {
  const lines: string[] = [];
  lines.push(
    `Starling workspace stress — ${report.files.toLocaleString('en-US')} files, ${report.worktrees} worktrees`,
  );
  lines.push(`repo:         ${report.repo}`);
  lines.push(`worktreeRoot: ${report.worktreeRoot}`);
  lines.push(
    `load average: ${report.loadAverage.map((value) => value.toFixed(1)).join(' / ')} ` +
      '(1 / 5 / 15 min — absolute timings include whatever else the machine was doing)',
  );
  lines.push('');

  const header = ['operation', 'n', 'fail', 'p50', 'p95', 'p99', 'max', 'total'];
  const rows = report.operations.map((operation) => [
    operation.operation,
    String(operation.count),
    String(operation.failures),
    ms(operation.p50Ms),
    ms(operation.p95Ms),
    ms(operation.p99Ms),
    ms(operation.maxMs),
    ms(operation.totalMs),
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const render = (row: string[]): string =>
    row
      .map((cell, column) =>
        column === 0 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0),
      )
      .join('  ');
  lines.push(render(header));
  lines.push(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) lines.push(render(row));
  lines.push('');

  const checks = report.checks;
  lines.push(
    `total ${ms(report.totalMs)} (setup ${ms(report.setupMs)})   ` +
      `failures ${report.failures.length}   ${report.ok ? 'OK' : 'FAILED'}`,
  );
  lines.push(
    `checks: ${checks.commits}/${report.worktrees} commits, ` +
      `${checks.diffs}/${report.worktrees} diffs, ` +
      `${checks.conflictsFound}/${checks.conflictsExpected} conflicting pairs found, ` +
      `${checks.bundlesFetched}/${report.bundles} bundles fetched, ` +
      `${checks.worktreesRemoved}/${report.worktrees} worktrees removed, ` +
      `${checks.worktreesRegisteredAfter} registered after cleanup`,
  );

  const disk = report.disk;
  lines.push('');
  lines.push(
    `disk: ${formatBytes(disk.perWorktreeAvgBytes)} per worktree ` +
      `(p50 ${formatBytes(disk.perWorktreeP50Bytes)}, p95 ${formatBytes(disk.perWorktreeP95Bytes)}; ` +
      `~${disk.fullWorktreeFiles.toLocaleString('en-US')} files each), ` +
      `${formatBytes(disk.totalWorktreeBytes)} for ${report.worktrees} worktrees`,
  );
  lines.push(
    `      .git ${formatBytes(disk.repoGitBytes)} (shared by all worktrees), ` +
      `main checkout ${formatBytes(disk.repoCheckoutBytes)}, ` +
      `bundles ${formatBytes(disk.bundleBytes)}`,
  );
  if (disk.sparse !== undefined) {
    const reduction = Math.max(0, Math.round((1 - disk.sparse.ratioOfFull) * 100));
    lines.push(
      `      sparse lane (${disk.sparse.directories.join(', ')}): ` +
        `${formatBytes(disk.sparse.bytes)} / ${disk.sparse.files} files — ` +
        `${reduction}% smaller than a full checkout`,
    );
  }

  if (report.failures.length > 0) {
    lines.push('');
    lines.push('failures:');
    for (const failure of report.failures) {
      lines.push(`  [${failure.operation}] ${failure.target}: ${failure.message.split('\n')[0]}`);
    }
  }
  if (report.kept) {
    lines.push('');
    lines.push('kept on disk (--keep): remove the repo above when you are done.');
  }
  return lines.join('\n');
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const report = await runStress({
    files: args.files,
    worktrees: args.worktrees,
    conflictPairs: args.pairs,
    bundles: args.bundles,
    root: args.root,
    keep: args.keep,
    sparse: args.sparse,
    log: (line) => process.stderr.write(`${line}\n`),
  });

  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatReport(report));

  process.exit(report.ok ? 0 : 1);
}
