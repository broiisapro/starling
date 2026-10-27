#!/usr/bin/env bun
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// See the note in `exec.ts`: tools/ is outside the Bun workspace, so core is imported by path.
import { StarlingError } from '../../packages/core/src/index.ts';

import { assembleStats, deriveRowsFromGit, summaryLines, type TestsAtEpic } from './assemble';
import { readEpicRows } from './epics';
import type { RunCommand } from './exec';
import { runCommand } from './exec';
import { readMergedPullRequests } from './gh';
import { countTestsAt, type GitSnapshot, type GitTag, gitToplevel, readGitSnapshot } from './git';
import { readHandbackStatuses } from './handbacks';
import { readAgentSessions } from './logs';
import type { SwarmStats } from './types';

export interface CollectOptions {
  /** Any path inside the repository; defaults to the current directory. */
  repo?: string;
  /** Orchestrator agent logs; `null` disables them. Defaults to `../_logs` next to the repo. */
  logsDir?: string | null;
  /** Ask GitHub for merged PRs. Defaults to true. */
  useGh?: boolean;
  /** Injectable clock, for tests. */
  now?: number;
  /** Injectable command runner, for tests (git must stay real; only `gh` is usually faked). */
  run?: RunCommand;
}

/**
 * Test declarations at the tag created by each wave's last merge, keyed by epic number.
 *
 * One `git grep` per wave, not per epic: the page only needs "total tests after the wave", and the
 * last merge is what defines that total.
 */
async function testsAfterByWave(
  run: RunCommand,
  root: string,
  git: GitSnapshot,
  waveOf: Map<string, string>,
): Promise<Map<string, TestsAtEpic>> {
  const groups = new Map<string, GitTag[]>();
  for (const tag of git.tags.values()) {
    const wave = waveOf.get(tag.number) ?? 'unknown';
    const bucket = groups.get(wave);
    if (bucket === undefined) groups.set(wave, [tag]);
    else bucket.push(tag);
  }

  const result = new Map<string, TestsAtEpic>();
  for (const tags of groups.values()) {
    const last = [...tags].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)).at(-1);
    if (last === undefined) continue;
    const count = await countTestsAt(run, root, last.name);
    result.set(last.number, { tests: count.tests, ref: last.name });
  }
  return result;
}

/** Resolve the default agent-log directory: `<parent of repo>/_logs`. */
export function defaultLogsDir(root: string): string {
  return process.env.STARLING_STATS_LOGS ?? join(dirname(root), '_logs');
}

/**
 * Collect the full swarm story from git, GitHub, `epics.tsv`, the handbacks and the agent logs.
 *
 * Every source except git is optional; anything unavailable is reported in `notes` rather than
 * thrown, so the page can say "GitHub was not reachable" instead of showing nothing.
 */
export async function collectStats(options: CollectOptions = {}): Promise<SwarmStats> {
  const run = options.run ?? runCommand;
  const cwd = options.repo === undefined ? process.cwd() : resolve(options.repo);
  const root = await gitToplevel(run, cwd);
  if (root === null) {
    throw new StarlingError('INVALID_ARGUMENT', `not a git repository: ${cwd}`);
  }

  const notes: string[] = [];
  const rows = await readEpicRows(join(root, '.orchestrator/epics.tsv'));
  const git = await readGitSnapshot(run, root);
  const planRows = rows ?? deriveRowsFromGit(git);

  const { prs, note: prNote } =
    options.useGh === false
      ? { prs: null, note: 'gh: skipped (--no-gh)' }
      : await readMergedPullRequests(run, root);
  if (prNote !== undefined) notes.push(prNote);

  const logsDir = options.logsDir === undefined ? defaultLogsDir(root) : options.logsDir;
  const sessions = logsDir === null ? null : await readAgentSessions(logsDir);
  const handbacks = await readHandbackStatuses(join(root, '.orchestrator/handbacks'), planRows);
  const testsAfter = await testsAfterByWave(
    run,
    root,
    git,
    new Map(planRows.map((row) => [row.number, row.wave])),
  );

  return assembleStats({
    repoRoot: root,
    git,
    rows,
    prs,
    handbacks,
    sessions,
    testsAfter,
    generatedAt: options.now ?? Date.now(),
    notes,
  });
}

/** Write `stats.json` (creating `out/`), returning the absolute path written. */
export async function writeStats(stats: SwarmStats, out: string): Promise<string> {
  const path = resolve(out);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
  return path;
}

export interface CliArgs {
  repo?: string;
  out?: string;
  logsDir?: string | null;
  useGh: boolean;
  json: boolean;
  help: boolean;
}

export const USAGE = `Usage: bun tools/stats/collect.ts [options]

Collects this repo's built-by-the-flock stats into tools/stats/out/stats.json.

Options:
  --repo <path>   Any path inside the repository (default: the current directory)
  --out <path>    Where to write the JSON (default: <repo>/tools/stats/out/stats.json)
  --logs <path>   Orchestrator agent logs (default: <repo>/../_logs; "none" to disable)
  --no-gh         Skip GitHub; PR numbers and merge times fall back to tags
  --json          Print the JSON instead of the human summary
  -h, --help      Show this help`;

/** Parse the CLI flags (also used by the tests). Unknown flags are an error, not a silent no-op. */
export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { useGh: true, json: false, help: false, logsDir: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    const [flag, inline] = arg.includes('=') ? (arg.split(/=(.*)/s) as [string, string]) : [arg, undefined];
    const value = (): string => {
      if (inline !== undefined) return inline;
      index += 1;
      const next = argv[index];
      if (next === undefined) throw new StarlingError('INVALID_ARGUMENT', `${flag} needs a value`);
      return next;
    };
    switch (flag) {
      case '--repo':
        args.repo = value();
        break;
      case '--out':
        args.out = value();
        break;
      case '--logs': {
        const logs = value();
        args.logsDir = logs === 'none' ? null : logs;
        break;
      }
      case '--no-gh':
        args.useGh = false;
        break;
      case '--json':
        args.json = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        throw new StarlingError('INVALID_ARGUMENT', `unknown option: ${arg}\n\n${USAGE}`);
    }
  }
  return args;
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const stats = await collectStats({ repo: args.repo, useGh: args.useGh, logsDir: args.logsDir });
  const out = args.out ?? join(stats.repo.root, 'tools/stats/out/stats.json');
  const written = await writeStats(stats, out);
  if (args.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }
  for (const line of summaryLines(stats)) console.log(line);
  for (const note of stats.notes) console.log(`note: ${note}`);
  console.log(`wrote ${written}`);
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
