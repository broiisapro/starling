import type { ExecResult } from '@starling/core';
import { exec } from '@starling/core';
import { GitHubError } from './errors';

export interface GhClientOptions {
  /** Directory gh/git run in unless a call passes its own cwd. */
  cwd: string;
  /** Injected for tests (L13/L14: every shell-out goes through core's `exec`). */
  execFn?: typeof exec;
  dryRun: boolean;
  /** Shared with the tracker: every gh/git argv is appended here while dry-running. */
  log: string[];
  /** `owner/name`. Auto-detected via `gh repo view` when omitted. */
  repo?: string;
}

/**
 * Thin, injectable wrapper around the `gh` and `git` CLIs.
 *
 * Responsibilities:
 * - dry-run: never spawn. Record the argv and hand back a successful empty result.
 * - auth: one `gh auth status` probe per client, mapped to `GitHubError('GH_AUTH')`.
 * - repo: lazy `gh repo view --json nameWithOwner`, cached for the client's lifetime.
 * - errors: a non-zero `gh` exit becomes a `GitHubError`, with an auth-looking stderr promoted to
 *   `GH_AUTH` so callers (and `starling doctor`) can tell "log in" from "gh is unhappy".
 */
export class GhClient {
  private readonly o: Required<Pick<GhClientOptions, 'cwd' | 'dryRun' | 'log'>> &
    Pick<GhClientOptions, 'execFn' | 'repo'>;
  private authChecked = false;
  private repoPromise: Promise<string> | undefined;

  constructor(options: GhClientOptions) {
    this.o = options;
  }

  /** Recorded argv, oldest first. A copy: callers cannot mutate the tracker's log. */
  dryRunLog(): string[] {
    return [...this.o.log];
  }

  async git(args: string[], cwd?: string): Promise<ExecResult> {
    return this.run(['git', ...args], cwd ?? this.o.cwd);
  }

  async gh(args: string[], cwd?: string): Promise<ExecResult> {
    await this.ensureAuth();
    return this.run(['gh', ...args], cwd ?? this.o.cwd);
  }

  async repo(): Promise<string> {
    if (this.o.repo !== undefined && this.o.repo !== '') return this.o.repo;
    if (this.o.dryRun) return 'OWNER/REPO';
    this.repoPromise ??= this.detectRepo();
    return this.repoPromise;
  }

  /** `gh auth status` once, then remember. Dry-run trusts the user. */
  async ensureAuth(): Promise<void> {
    if (this.o.dryRun || this.authChecked) return;
    const res = await this.run(['gh', 'auth', 'status'], this.o.cwd);
    if (res.code !== 0) {
      throw new GitHubError(
        'GH_AUTH',
        'GitHub CLI is not authenticated. Run `gh auth login` (or `gh auth status` to inspect accounts).',
        { details: { exitCode: res.code, stderr: tail(res.stderr) } },
      );
    }
    this.authChecked = true;
  }

  /** `gh label list --json name`, returned as a set. Empty in dry-run. */
  async labelNames(): Promise<Set<string>> {
    const data = await this.ghJson(['label', 'list', '--limit', '200', '--json', 'name']);
    const names = new Set<string>();
    if (Array.isArray(data)) {
      for (const item of data) {
        if (isRecord(item) && typeof item.name === 'string') names.add(item.name);
      }
    }
    return names;
  }

  /** Issues carrying `label`, newest first from gh. Empty in dry-run. */
  async issuesWithLabel(label: string): Promise<Array<{ number: number; body: string }>> {
    const data = await this.ghJson([
      'issue',
      'list',
      '--label',
      label,
      '--state',
      'all',
      '--limit',
      '500',
      '--json',
      'number,body',
    ]);
    if (!Array.isArray(data)) return [];
    const issues: Array<{ number: number; body: string }> = [];
    for (const item of data) {
      if (isRecord(item) && typeof item.number === 'number' && typeof item.body === 'string') {
        issues.push({ number: item.number, body: item.body });
      }
    }
    return issues;
  }

  /** Turn a failed gh/git result into a coded error, promoting auth stderr. */
  failure(label: string, res: ExecResult): GitHubError {
    const stderr = res.stderr.trim();
    const authish = /not logged in|authentication|auth login|bad credentials|http 401|permission denied/i;
    const message = `${label} failed (exit ${res.code})${stderr === '' ? '' : `: ${tail(stderr)}`}`;
    return new GitHubError(authish.test(stderr) ? 'GH_AUTH' : 'GH_COMMAND', message, {
      details: { exitCode: res.code, argv: label },
    });
  }

  private async detectRepo(): Promise<string> {
    const res = await this.gh(['repo', 'view', '--json', 'nameWithOwner']);
    if (res.code !== 0) {
      const authish = /not logged in|authentication|auth login|bad credentials|http 401/i;
      if (authish.test(res.stderr)) {
        throw new GitHubError('GH_AUTH', 'GitHub CLI is not authenticated. Run `gh auth login`.', {
          details: { stderr: tail(res.stderr) },
        });
      }
      throw new GitHubError('GH_REPO', 'Could not detect the GitHub repo; pass `repo: "owner/name"`.', {
        details: { exitCode: res.code, stderr: tail(res.stderr) },
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.stdout);
    } catch {
      throw new GitHubError('GH_REPO', 'Could not parse `gh repo view` output; pass `repo` explicitly.', {
        details: { stdout: tail(res.stdout) },
      });
    }
    if (!isRecord(parsed) || typeof parsed.nameWithOwner !== 'string') {
      throw new GitHubError('GH_REPO', 'Could not detect the GitHub repo; pass `repo: "owner/name"`.');
    }
    return parsed.nameWithOwner;
  }

  private async ghJson(args: string[]): Promise<unknown> {
    const res = await this.gh(args);
    if (this.o.dryRun) return null;
    if (res.code !== 0) throw this.failure(`gh ${args.slice(0, 2).join(' ')}`, res);
    try {
      return JSON.parse(res.stdout);
    } catch {
      throw new GitHubError(
        'GH_COMMAND',
        `gh returned non-JSON output for \`${args.slice(0, 2).join(' ')}\``,
        {
          details: { stdout: tail(res.stdout) },
        },
      );
    }
  }

  private async run(cmd: string[], cwd: string): Promise<ExecResult> {
    if (this.o.dryRun) {
      this.o.log.push(shellJoin(cmd));
      return { code: 0, stdout: '', stderr: '', durationMs: 0 };
    }
    try {
      return await (this.o.execFn ?? exec)(cmd, { cwd });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new GitHubError('GH_MISSING', `Could not run \`${cmd[0]}\`: ${detail}`, { cause: err });
    }
  }
}

/** Show an argv the way a shell would, for the dry-run preview. */
export function shellJoin(argv: string[]): string {
  return argv.map(quote).join(' ');
}

function quote(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.split("'").join("'\\''")}'`;
}

function tail(text: string, max = 400): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(-max)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
