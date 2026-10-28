#!/usr/bin/env bun
import { locateCache, readSegment } from './cache.ts';
import type { FetchLike } from './refresh.ts';
import type { SegmentStyle } from './segment.ts';

/**
 * `starling-prompt` — the whole prompt helper, in one file.
 *
 *   starling-prompt [--refresh] [--ascii] [--style zsh|bash|plain] [--server URL] [--token T]
 *                   [--interval-ms N] [--path]
 *
 * Without `--refresh` it reads the cache and prints it: no network, no imports of `refresh.ts`, no
 * clock. That is the path your shell runs on every prompt (`starling.zsh`/`.bash` read the file
 * directly and never even spawn this), and it is the one the tests prove makes zero fetch calls.
 *
 * With `--refresh` it performs exactly one refresh and exits. Always exit 0 on the happy-ish paths:
 * a prompt helper that returns non-zero shows up in `$?` and in people's `starship`-style guards.
 */
const DEFAULT_SERVER = 'http://127.0.0.1:7777';

export const USAGE = `starling-prompt — a one-line Starling status for your shell prompt

Usage:
  starling-prompt [options]

Options:
  --refresh            Ask the hub once and rewrite the cache (network). Default: read the cache only.
  --ascii              ASCII output (st 12/30) instead of the bird (🐦 12/30).
  --style <style>      plain | zsh | bash. zsh/bash wrap colour in %{…%}/\\[…\\]. Default: plain.
  --server <url>       Hub base URL. Default: $STARLING_PROMPT_SERVER, $STARLING_HUB_URL, ${DEFAULT_SERVER}.
  --token <token>      Sent as x-flock-token on --refresh. Default: $STARLING_TOKEN, $STARLING_FLOCK_TOKEN.
  --interval-ms <n>    With --refresh: do nothing if the last attempt is younger than n ms.
  --path               Print the cache file path (for the shell snippets) and exit.
  -h, --help           Show this help.

Environment:
  STARLING_PROMPT=off        Disables everything (read and refresh).
  STARLING_PROMPT_ASCII=1    Same as --ascii.
  STARLING_PROMPT_SERVER     Hub URL, same as --server.
  STARLING_PROMPT_CACHE_DIR  Override the cache directory.
  NO_COLOR                   Any value forces --style plain.
`;

export interface CliOptions {
  refresh: boolean;
  ascii: boolean;
  style: SegmentStyle;
  serverUrl: string;
  token?: string;
  intervalMs: number;
  pathOnly: boolean;
  help: boolean;
  error?: string;
}

function parseStyle(value: string): SegmentStyle | undefined {
  return value === 'plain' || value === 'zsh' || value === 'bash' ? value : undefined;
}

function truthy(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0';
}

/**
 * Parse argv + the environment. `--help` wins over everything; a bad flag sets `error` and the caller
 * prints usage to stderr and exits 2 (a typo should be visible, unlike a dead hub).
 */
export function parseArgs(argv: readonly string[], env: Record<string, string | undefined> = {}): CliOptions {
  const options: CliOptions = {
    refresh: false,
    ascii: truthy(env.STARLING_PROMPT_ASCII),
    style: 'plain',
    serverUrl: env.STARLING_PROMPT_SERVER?.trim() || env.STARLING_HUB_URL?.trim() || DEFAULT_SERVER,
    token: env.STARLING_TOKEN?.trim() || env.STARLING_FLOCK_TOKEN?.trim() || undefined,
    intervalMs: 0,
    pathOnly: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--refresh':
        options.refresh = true;
        break;
      case '--ascii':
        options.ascii = true;
        break;
      case '--path':
        options.pathOnly = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      case '--style': {
        const value = argv[index + 1];
        index += 1;
        const style = value === undefined ? undefined : parseStyle(value);
        if (!style) {
          options.error = `--style needs plain|zsh|bash${value === undefined ? '' : ` (got ${value})`}`;
          return options;
        }
        options.style = style;
        break;
      }
      case '--server': {
        const value = argv[index + 1];
        index += 1;
        if (value === undefined || value.length === 0) {
          options.error = '--server needs a URL';
          return options;
        }
        options.serverUrl = value;
        break;
      }
      case '--token': {
        const value = argv[index + 1];
        index += 1;
        if (value === undefined) {
          options.error = '--token needs a value';
          return options;
        }
        options.token = value;
        break;
      }
      case '--interval-ms': {
        const value = argv[index + 1];
        index += 1;
        const parsed = value === undefined ? Number.NaN : Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          options.error = `--interval-ms needs a non-negative number${value === undefined ? '' : ` (got ${value})`}`;
          return options;
        }
        options.intervalMs = Math.trunc(parsed);
        break;
      }
      default:
        options.error = `unknown option ${arg}`;
        return options;
    }
  }

  // NO_COLOR (no-color.org) is presence-based: any value, including the empty string, means "no colour".
  if (env.NO_COLOR !== undefined) options.style = 'plain';
  return options;
}

export interface CliIO {
  env?: Record<string, string | undefined>;
  /** Called with the text to show (no trailing newline). Defaults to `process.stdout.write`. */
  print?: (text: string) => void;
  /** Called with usage/diagnostics. Defaults to `process.stderr.write`. */
  printError?: (text: string) => void;
  /** Injected for the refresh path; a read-path test passes one that throws. */
  fetch?: FetchLike;
  now?: () => number;
}

/** Run the CLI in-process. Returns the exit code (0 normally, 2 for a bad invocation). */
export async function runCli(argv: readonly string[], io: CliIO = {}): Promise<number> {
  const env = io.env ?? process.env;
  const print = io.print ?? ((text: string) => process.stdout.write(`${text}\n`));
  const printError = io.printError ?? ((text: string) => process.stderr.write(`${text}\n`));
  const options = parseArgs(argv, env);

  if (options.error) {
    printError(`starling-prompt: ${options.error}`);
    printError(USAGE.trimEnd());
    return 2;
  }
  if (options.help) {
    print(USAGE.trimEnd());
    return 0;
  }
  // `STARLING_PROMPT=off` disables everything, including the refresh: a disabled prompt should not
  // be the one thing still dialling the hub.
  if (env.STARLING_PROMPT === 'off') return 0;

  const location = locateCache(options.serverUrl, {
    cacheDir: env.STARLING_PROMPT_CACHE_DIR?.trim() || undefined,
    env,
  });

  if (options.pathOnly) {
    print(location.segmentPath);
    return 0;
  }

  if (!options.refresh) {
    const cached = readSegment(location);
    if (cached !== '') print(cached);
    return 0;
  }

  // Imported lazily so the hot read path never even loads the HTTP module.
  const { refresh } = await import('./refresh.ts');
  const outcome = await refresh({
    serverUrl: options.serverUrl,
    token: options.token,
    fetch: io.fetch,
    now: io.now,
    cacheDir: location.dir,
    ascii: options.ascii,
    style: options.style,
    intervalMs: options.intervalMs,
    env,
  });
  if (outcome.segment !== '') print(outcome.segment);
  return 0;
}

if (import.meta.main) {
  process.exit(await runCli(process.argv.slice(2)));
}
