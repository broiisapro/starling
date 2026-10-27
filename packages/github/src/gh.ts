import type { ExecResult } from '@starling/core';
import { exec, StarlingError } from '@starling/core';
import { GitHubError } from './errors';

/** GitHub rejects issue/PR/comment bodies longer than this, with `Body is too long`. */
export const GITHUB_MAX_BODY_CHARS = 65_536;

/** Appended when a rendered body has to be cut down to fit GitHub's limit. */
export const BODY_TRUNCATION_NOTE =
  '\n\n---\n\n_✂️ Body truncated by Starling: GitHub caps bodies at 65,536 characters._\n';

export interface GhRetryOptions {
  /** Total attempts, including the first. Default 4. */
  attempts?: number;
  /** First backoff delay. Doubles per attempt. Default 1500 ms. */
  baseDelayMs?: number;
  /** Backoff ceiling. Default 20 000 ms. */
  maxDelayMs?: number;
}

export interface GhClientOptions {
  /** Directory gh/git run in unless a call passes its own cwd. */
  cwd: string;
  /** Injected for tests (L13/L14: every shell-out goes through core's `exec`). */
  execFn?: typeof exec;
  dryRun: boolean;
  /** Shared with the tracker: every gh/git argv is appended here while dry-running. */
  log: string[];
  /** `owner/name`. Auto-detected via `gh repo view` (or the `origin` remote) when omitted. */
  repo?: string;
  /** Per-command timeout. Default 120 000 ms so a hung network call cannot hang a run forever. */
  timeoutMs?: number;
  /** Backoff policy for secondary rate limits and transient transport failures. */
  retry?: GhRetryOptions;
  /** Injected in tests so backoff does not actually wait. Defaults to a `setTimeout` sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Non-fatal notices (a PR skipped because there is nothing to review, a retry, …). */
  warn?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 1_500;
const DEFAULT_MAX_DELAY_MS = 20_000;

/**
 * Thin, injectable wrapper around the `gh` and `git` CLIs.
 *
 * Responsibilities:
 * - dry-run: never spawn. Record the argv and hand back a successful empty result.
 * - auth: one `gh auth status` probe per client, mapped to `GitHubError('GH_AUTH')`.
 * - repo: lazy `gh repo view --json nameWithOwner`, falling back to the `origin` remote (which is
 *   what actually works inside a `git worktree`), cached for the client's lifetime.
 * - resilience: a timeout per command and exponential backoff for GitHub's secondary rate limits
 *   (`You have exceeded a secondary rate limit…`), which real sandbox runs do hit.
 * - errors: a non-zero `gh` exit becomes a `GitHubError`, with an auth-looking stderr promoted to
 *   `GH_AUTH` so callers (and `starling doctor`) can tell "log in" from "gh is unhappy".
 */
export class GhClient {
  private readonly o: Required<Pick<GhClientOptions, 'cwd' | 'dryRun' | 'log'>> &
    Pick<GhClientOptions, 'execFn' | 'repo' | 'timeoutMs' | 'retry' | 'sleep' | 'warn'>;
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
    const rateLimited = /rate limit/i.test(stderr) && !/secondary rate limit/i.test(stderr);
    const suffix = rateLimited ? ' GitHub rate limit reached; wait for the window to reset.' : '';
    const message = `${label} failed (exit ${res.code})${stderr === '' ? '' : `: ${tail(stderr)}`}${suffix}`;
    return new GitHubError(authish.test(stderr) ? 'GH_AUTH' : 'GH_COMMAND', message, {
      details: { exitCode: res.code, argv: label },
    });
  }

  private async detectRepo(): Promise<string> {
    const res = await this.gh(['repo', 'view', '--json', 'nameWithOwner']);
    if (res.code === 0) {
      try {
        const parsed: unknown = JSON.parse(res.stdout);
        if (isRecord(parsed) && typeof parsed.nameWithOwner === 'string') return parsed.nameWithOwner;
      } catch {
        throw new GitHubError('GH_REPO', 'Could not parse `gh repo view` output; pass `repo` explicitly.', {
          details: { stdout: tail(res.stdout) },
        });
      }
      throw new GitHubError('GH_REPO', 'Could not detect the GitHub repo; pass `repo: "owner/name"`.');
    }

    const authish = /not logged in|authentication|auth login|bad credentials|http 401/i;
    if (authish.test(res.stderr)) {
      throw new GitHubError('GH_AUTH', 'GitHub CLI is not authenticated. Run `gh auth login`.', {
        details: { stderr: tail(res.stderr) },
      });
    }

    // `gh repo view` needs to map a remote to a known host; in a bare worktree (or when the remote
    // was added after cloning) it can fail even though the repo is obvious from `origin`. Real
    // behaviour seen in the sandbox: "none of the git remotes correspond to a known GitHub host".
    const remote = await this.run(['git', 'remote', 'get-url', 'origin'], this.o.cwd);
    if (remote.code === 0) {
      const derived = parseGitHubRemote(remote.stdout);
      if (derived !== undefined) {
        this.o.warn?.(`Detected ${derived} from the origin remote instead of \`gh repo view\`.`);
        return derived;
      }
    }

    throw new GitHubError('GH_REPO', 'Could not detect the GitHub repo; pass `repo: "owner/name"`.', {
      details: { exitCode: res.code, stderr: tail(res.stderr) },
    });
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
        { details: { stdout: tail(res.stdout) } },
      );
    }
  }

  /**
   * Spawn (or record, in dry-run) one command, retrying secondary rate limits and transport
   * failures with exponential backoff. Windows: GitHub's secondary limit usually clears in
   * seconds, so four attempts at 1.5 s/3 s/6 s keep a run alive without stalling it for minutes.
   */
  private async run(cmd: string[], cwd: string): Promise<ExecResult> {
    if (this.o.dryRun) {
      this.o.log.push(shellJoin(cmd));
      return { code: 0, stdout: '', stderr: '', durationMs: 0 };
    }

    const attempts = Math.max(1, this.o.retry?.attempts ?? DEFAULT_ATTEMPTS);
    const timeoutMs = this.o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let last: ExecResult = { code: 1, stdout: '', stderr: 'gh retry budget exhausted', durationMs: 0 };

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      let res: ExecResult;
      try {
        res = await (this.o.execFn ?? exec)(cmd, timeoutMs > 0 ? { cwd, timeoutMs } : { cwd });
      } catch (err) {
        if (err instanceof StarlingError && err.code === 'EXEC_FAILED') {
          const detail = err instanceof Error ? err.message : String(err);
          throw new GitHubError('GH_MISSING', `Could not run \`${cmd[0]}\`: ${detail}`, { cause: err });
        }
        // EXEC_TIMEOUT: retry like a dropped connection, then report it as a command failure.
        if (err instanceof StarlingError && err.code === 'EXEC_TIMEOUT') {
          res = { code: 124, stdout: '', stderr: `timed out after ${timeoutMs}ms`, durationMs: timeoutMs };
        } else {
          const detail = err instanceof Error ? err.message : String(err);
          throw new GitHubError('GH_COMMAND', `Could not run \`${cmd[0]}\`: ${detail}`, { cause: err });
        }
      }

      if (res.code === 0 || !isRetryableGhFailure(res)) return res;
      last = res;
      if (attempt === attempts) break;

      const delay = backoffMs(attempt, this.o.retry);
      this.o.warn?.(
        `${cmd.slice(0, 3).join(' ')} hit a transient GitHub failure; retrying in ${delay} ms (${attempt}/${attempts - 1}).`,
      );
      await (this.o.sleep ?? sleep)(delay);
    }

    return last;
  }
}

/** Show an argv the way a shell would, for the dry-run preview. */
export function shellJoin(argv: string[]): string {
  return argv.map(quote).join(' ');
}

/**
 * Fit a rendered markdown body inside GitHub's 65,536-character cap.
 *
 * Real behaviour captured in the Epic 43 sandbox: `gh pr create --body-file big.md` fails with
 * `GraphQL: Body is too long (maximum is 65536 characters)`; `gh issue create` does the same. Long
 * worker diffs belong in the git diff, not in the PR description, so we cut and say so.
 */
export function clampBody(body: string, max = GITHUB_MAX_BODY_CHARS): string {
  if (body.length <= max) return body;
  const note = BODY_TRUNCATION_NOTE;
  // Keep both ends: the tail holds `Closes #N` and the footer, which a judge (and GitHub's own
  // issue-closing automation) needs. Only the middle of a runaway body is disposable.
  const tailLen = Math.min(2_000, Math.floor((max - note.length) / 4));
  const headLen = Math.max(0, max - note.length - tailLen);
  return `${body.slice(0, headLen).trimEnd()}${note}${body.slice(-tailLen)}`;
}

/**
 * True when re-running the same command could work: GitHub's secondary (abuse) rate limit,
 * 5xx responses and dropped connections. Primary rate limits and validation errors are final.
 */
export function isRetryableGhFailure(res: ExecResult): boolean {
  if (res.code === 0) return false;
  const text = `${res.stderr}\n${res.stdout}`;
  if (/secondary rate limit|abuse detection|temporarily blocked/i.test(text)) return true;
  if (/api rate limit exceeded/i.test(text)) return false;
  return /timed out|connection reset|econnreset|unexpected eof|tls handshake|http 5\d\d|bad gateway|service unavailable|gateway timeout/i.test(
    text,
  );
}

/** `git@github.com:owner/name.git`, `ssh://git@github.com/owner/name`, `https://github.com/o/n`. */
export function parseGitHubRemote(remote: string): string | undefined {
  const trimmed = remote.trim();
  if (trimmed === '') return undefined;

  const scp = /^(?:[\w.-]+@)?github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(trimmed);
  if (scp !== null && scp[1] !== undefined && scp[2] !== undefined) return `${scp[1]}/${scp[2]}`;

  const url =
    /^(?:ssh|https?):\/\/(?:[^@/]+@)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
      trimmed,
    );
  if (url !== null && url[1] !== undefined && url[2] !== undefined) return `${url[1]}/${url[2]}`;

  return undefined;
}

/** `1.5s, 3s, 6s, …` capped at `maxDelayMs`, with ±20 % jitter so parallel agents do not sync up. */
export function backoffMs(attempt: number, retry?: GhRetryOptions): number {
  const base = retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = retry?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const raw = Math.min(max, base * 2 ** (attempt - 1));
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(Math.min(max, Math.max(1, raw * jitter)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
