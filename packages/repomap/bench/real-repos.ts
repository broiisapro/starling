#!/usr/bin/env bun
/**
 * real-repos.ts — map six real open-source repos and print what the repo mapper saw.
 *
 *   bun packages/repomap/bench/real-repos.ts [--dir CACHE] [--only name] [--refresh] [--repeat 3] [--json]
 *
 * The six cover the shapes a plan actually meets: a pnpm TypeScript monorepo, a pytest Python
 * package, a Go service, a Rust workspace, a Vite/React app tree and a ~7k-file Django checkout
 * (translations, fixtures and a stray package.json included). For each one it reports files kept,
 * languages, symbols per file, detected test/lint commands, token estimate and wall time.
 *
 * This is a **bench, not a test**: it needs the network for the first clone (unit tests must not).
 * Clones are cached under `--dir` (default `<tmp>/starling-repomap-bench`), so a second run is
 * offline and measures the same commits. `--refresh` moves the cache to each repo's current HEAD.
 *
 * `expectedTest`/`expectedLint` are the ground truth, verified by hand from each repo's own
 * configuration (script, config section, CI workflow) — see `evidence`. The script exits 1 when a
 * detected command disagrees, so it doubles as a smoke check for `commands.ts`.
 */
import { mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepoMap } from '@starling/core';
import { exec } from '@starling/core';
import { createRepoMapper, langForPath } from '../src/index.ts';

interface BenchRepo {
  /** Short name, also the clone directory. */
  name: string;
  url: string;
  /** The shape this repo stands in for. */
  shape: string;
  /** Commit the numbers in `docs/epic-56-repomap-prompts.md` were measured at. */
  sha: string;
  /** The command a maintainer runs from the repo root. */
  expectedTest: string;
  expectedLint?: string;
  /** Where the expectation comes from, so "correct" is not a guess. */
  evidence: string;
}

export const BENCH_REPOS: readonly BenchRepo[] = [
  {
    name: 'changesets',
    url: 'https://github.com/changesets/changesets.git',
    shape: 'TS monorepo (pnpm)',
    sha: 'b09779a',
    expectedTest: 'pnpm test',
    expectedLint: 'pnpm run lint',
    evidence: 'root package.json scripts.test = "vitest", scripts.lint = "eslint", pnpm-lock.yaml',
  },
  {
    name: 'click',
    url: 'https://github.com/pallets/click.git',
    shape: 'Python package (pytest)',
    sha: '2247b35',
    expectedTest: 'pytest',
    evidence: 'pyproject.toml [tool.pytest.ini_options], tests/test_*.py',
  },
  {
    name: 'gin',
    url: 'https://github.com/gin-gonic/gin.git',
    shape: 'Go service',
    sha: '0f09c3a',
    expectedTest: 'go test ./...',
    expectedLint: 'make lint',
    evidence: 'go.mod + Makefile test/lint targets; CI runs `go test ./...`',
  },
  {
    name: 'serde',
    url: 'https://github.com/serde-rs/serde.git',
    shape: 'Rust crate (cargo workspace)',
    sha: '0db9b3b',
    expectedTest: 'cargo test --workspace',
    evidence: 'virtual [workspace] manifest with five members and no [package]',
  },
  {
    name: 'bulletproof-react',
    url: 'https://github.com/alan2207/bulletproof-react.git',
    shape: 'Vite/React app tree',
    sha: '9506629',
    expectedTest: 'yarn --cwd apps/nextjs-app test',
    expectedLint: 'yarn --cwd apps/nextjs-app lint',
    evidence: 'root package.json has no test script; apps/* each have their own package.json + yarn.lock',
  },
  {
    name: 'django',
    url: 'https://github.com/django/django.git',
    shape: '~7k files (large Python)',
    sha: 'e9cf067',
    expectedTest: 'python tests/runtests.py',
    evidence: 'tests/runtests.py harness per CONTRIBUTING.rst; Python lint is deliberately not guessed',
  },
];

interface Row {
  repo: string;
  shape: string;
  sha: string;
  listedPaths: number;
  files: number;
  languages: string;
  symbolsPerFile: number;
  filesWithSymbols: number;
  testCommand?: string;
  testOk: boolean;
  lintCommand?: string;
  lintOk: boolean;
  tokens: number;
  ms: number;
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function argNumber(argv: readonly string[], flag: string, fallback: number): number {
  const raw = argValue(argv, flag);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function hits(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await exec(['git', ...args], { cwd, timeoutMs: 120_000 });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.slice(0, 500)}`);
  return result.stdout;
}

/** Clone (or reuse, or refresh) the repo under `cacheDir`. Returns the checked-out commit. */
async function ensureClone(repo: BenchRepo, cacheDir: string, refresh: boolean): Promise<string> {
  const dir = join(cacheDir, repo.name);
  if (!(await exists(dir))) {
    process.stderr.write(`clone ${repo.url}\n`);
    const result = await exec(['git', 'clone', '--depth', '1', '--quiet', repo.url, dir], {
      cwd: cacheDir,
      timeoutMs: 300_000,
    });
    if (result.code !== 0) throw new Error(`clone failed for ${repo.name}: ${result.stderr.slice(0, 500)}`);
  } else if (refresh) {
    process.stderr.write(`refresh ${repo.name}\n`);
    await git(dir, ['fetch', '--depth', '1', '--quiet', 'origin', 'HEAD']);
    await git(dir, ['reset', '--hard', '--quiet', 'FETCH_HEAD']);
  }
  return (await git(dir, ['rev-parse', 'HEAD'])).trim();
}

function topLanguages(map: RepoMap, limit = 4): string {
  return Object.entries(map.languages)
    .filter(([lang]) => lang !== 'other')
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([lang, count]) => `${lang} ${count}`)
    .join(', ');
}

function report(map: RepoMap, listedPaths: number, elapsedMs: number, repo: BenchRepo, sha: string): Row {
  const symbols = map.files.reduce((total, file) => total + file.symbols.length, 0);
  const withSymbols = map.files.filter((file) => file.symbols.length > 0).length;
  return {
    repo: repo.name,
    shape: repo.shape,
    sha: `${sha.slice(0, 7)}${sha.startsWith(repo.sha) ? '' : '~'}`,
    listedPaths,
    files: map.files.length,
    languages: topLanguages(map),
    symbolsPerFile: map.files.length === 0 ? 0 : Math.round((symbols / map.files.length) * 10) / 10,
    filesWithSymbols: withSymbols,
    testCommand: map.testCommand,
    testOk: map.testCommand === repo.expectedTest,
    lintCommand: map.lintCommand,
    lintOk:
      repo.expectedLint === undefined ? map.lintCommand === undefined : map.lintCommand === repo.expectedLint,
    tokens: map.tokenEstimate,
    ms: Math.round(elapsedMs),
  };
}

function table(rows: readonly Row[]): string {
  const header = '| repo | shape | sha | paths→files | languages | sym/file | test | lint | tokens | ms |';
  const rule = '|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map(
    (row) =>
      `| ${row.repo} | ${row.shape} | ${row.sha} | ${row.listedPaths}→${row.files} | ${row.languages} | ` +
      `${row.symbolsPerFile} (${row.filesWithSymbols}) | ${row.testCommand ?? '—'} ${row.testOk ? '✓' : '✗'} | ` +
      `${row.lintCommand ?? '—'} ${row.lintOk ? '✓' : '✗'} | ${row.tokens} | ${row.ms} |`,
  );
  return [header, rule, ...body].join('\n');
}

function details(
  rows: readonly Row[],
  maps: ReadonlyMap<string, RepoMap>,
  repos: readonly BenchRepo[],
): string {
  const lines: string[] = [];
  for (const row of rows) {
    const repo = repos.find((candidate) => candidate.name === row.repo);
    const map = maps.get(row.repo);
    if (repo === undefined || map === undefined) continue;
    lines.push(`### ${repo.name} — ${repo.shape}`);
    lines.push(`expected: \`${repo.expectedTest}\`${repo.expectedLint ? ` / \`${repo.expectedLint}\`` : ''}`);
    lines.push(
      `detected: \`${row.testCommand ?? '(none)'}\`${row.lintCommand ? ` / \`${row.lintCommand}\`` : ''}`,
    );
    lines.push(`evidence: ${repo.evidence}`);
    const noisiest = [...map.files]
      .sort((a, b) => b.symbols.length - a.symbols.length || (a.path < b.path ? -1 : 1))
      .slice(0, 3)
      .filter((file) => file.symbols.length > 0);
    for (const file of noisiest) {
      const sample = file.symbols.slice(0, 8).join(', ');
      lines.push(
        `symbols ${file.path} (${file.symbols.length}): ${sample}${file.symbols.length > 8 ? ', …' : ''}`,
      );
    }
    const other = map.files.filter((file) => langForPath(file.path) === 'other').length;
    if (other > 0) lines.push(`unknown-extension files kept: ${other}`);
    lines.push('');
  }
  return lines.join('\n');
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (hits(argv, '--help') || hits(argv, '-h')) {
    process.stdout.write(
      'usage: bun packages/repomap/bench/real-repos.ts [--dir CACHE] [--only name] [--refresh] [--json]\n',
    );
    return 0;
  }

  const cacheDir = argValue(argv, '--dir') ?? join(tmpdir(), 'starling-repomap-bench');
  const only = argValue(argv, '--only');
  const refresh = hits(argv, '--refresh');
  const json = hits(argv, '--json');
  // Wall time on a loaded laptop is noisy; the table reports the best of N warm runs.
  const repeat = argNumber(argv, '--repeat', 3);
  const repos = only === undefined ? BENCH_REPOS : BENCH_REPOS.filter((repo) => repo.name === only);
  if (repos.length === 0)
    throw new Error(`unknown --only ${only}; known: ${BENCH_REPOS.map((r) => r.name).join(', ')}`);

  await mkdir(cacheDir, { recursive: true });
  const mapper = createRepoMapper();
  const rows: Row[] = [];
  const maps = new Map<string, RepoMap>();

  for (const repo of repos) {
    const sha = await ensureClone(repo, cacheDir, refresh);
    const dir = join(cacheDir, repo.name);
    const listed = await git(dir, ['ls-files', '-co', '--exclude-standard', '-z']);
    const listedPaths = listed.split('\0').filter((path) => path.length > 0).length;

    const started = performance.now();
    let map = await mapper.map(dir);
    let best = performance.now() - started;
    for (let run = 1; run < repeat; run += 1) {
      const retry = performance.now();
      map = await mapper.map(dir);
      best = Math.min(best, performance.now() - retry);
    }

    maps.set(repo.name, map);
    rows.push(report(map, listedPaths, best, repo, sha));
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ repos: rows, bench: BENCH_REPOS }, null, 2)}\n`);
    return rows.every((row) => row.testOk && row.lintOk) ? 0 : 1;
  }

  process.stdout.write(`# Repo map on real repos (${rows.length}/${BENCH_REPOS.length})\n\n`);
  process.stdout.write(`${table(rows)}\n\n`);
  const mismatches = rows.filter((row) => !row.testOk || !row.lintOk);
  process.stdout.write(
    mismatches.length === 0
      ? 'All detected commands match the hand-checked ground truth.\n\n'
      : `${mismatches.length} command mismatch(es): ${mismatches.map((row) => row.repo).join(', ')}\n\n`,
  );
  process.stdout.write(`${details(rows, maps, repos)}\n`);
  return mismatches.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = await main();
}
