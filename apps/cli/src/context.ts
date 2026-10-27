import type { ExecOptions, ExecResult, StarlingConfig } from '@starling/core';
import { exec as coreExec, isStarlingError, loadConfig, StarlingError } from '@starling/core';
import type { ComposeOptions, Composition } from './compose';
import { compose } from './compose';
import { createPalette, fixedPalette, type Palette } from './render/palette';

export type CliExec = (cmd: string[], opts: ExecOptions) => Promise<ExecResult>;

export interface CliIO {
  /** Write raw text; the caller controls newlines. */
  write(text: string): void;
  isTTY: boolean;
  columns: number;
}

export interface CliDeps {
  io?: Partial<CliIO>;
  execFn?: CliExec;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Pre-loaded config (tests); otherwise `loadConfig` reads the cwd. */
  config?: StarlingConfig;
  configPath?: string;
  mode?: ComposeOptions['mode'];
  mockStepMs?: number;
  /** Force colour on/off; otherwise TTY + NO_COLOR decide. */
  color?: boolean;
  freeMemGb?: () => number;
  totalMemGb?: () => number;
  fetchFn?: typeof fetch;
}

export interface CliContext {
  deps: CliDeps;
  io: CliIO;
  palette: Palette;
  cwd: string;
  env: Record<string, string | undefined>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  execFn: CliExec;
  columns: number;
  loadStarlingConfig(): StarlingConfig;
  composition(): Composition;
  /** Write a line (or a multi-line block) to stdout. */
  write(text?: string): void;
  writeErr(text: string): void;
  formatError(err: unknown): string;
}

/**
 * Build the shared command context. Deliberately lazy: `doctor` must be able to report a broken
 * config instead of dying on it, so the config is only loaded when a command asks for it.
 */
export function createCliContext(deps: CliDeps = {}): CliContext {
  const env = deps.env ?? process.env;
  const io: CliIO = {
    write: (text) => {
      process.stdout.write(text);
    },
    isTTY: process.stdout.isTTY === true,
    columns: process.stdout.columns ?? 100,
    ...deps.io,
  };
  const palette =
    deps.color === undefined ? createPalette({ isTTY: io.isTTY, env }) : fixedPalette(deps.color);
  const cwd = deps.cwd ?? process.cwd();
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  const context: CliContext = {
    deps,
    io,
    palette,
    cwd,
    env,
    now,
    sleep,
    execFn: deps.execFn ?? coreExec,
    columns: io.columns,
    loadStarlingConfig() {
      if (deps.config !== undefined) return deps.config;
      return loadConfig(deps.configPath, cwd);
    },
    composition() {
      return compose(context.loadStarlingConfig(), {
        mode: deps.mode ?? 'mock',
        stepMs: deps.mockStepMs ?? 55,
        now,
        sleep,
      });
    },
    write(text = '') {
      io.write(`${text}\n`);
    },
    writeErr(text) {
      io.write(`${text}\n`);
    },
    formatError(err) {
      return formatCliError(err, palette);
    },
  };

  return context;
}

const HINTS: Partial<Record<string, string>> = {
  CONFIG_INVALID: 'fix starling.config.yaml, or run `starling init --force` to start over',
  INVALID_ARGUMENT: 'run `starling <command> --help` for usage',
  EXEC_FAILED: 'is the binary installed and on your PATH?',
  EXEC_TIMEOUT: 'the command took too long — try again with a smaller repo',
  NOT_IMPLEMENTED: 'this part lands in a later wave',
  NOT_WIRED: 'real wiring lands in epic 40 — the mock composition is fully runnable now',
};

export function formatCliError(err: unknown, palette: Palette): string {
  if (isStarlingError(err)) {
    const lines = [palette.red(`✘ ${err.message}`), palette.dim(`  code ${err.code}`)];
    const hint = HINTS[err.code];
    if (hint !== undefined) lines.push(palette.dim(`  hint ${hint}`));
    return lines.join('\n');
  }
  if (err instanceof Error) {
    return `${palette.red(`✘ ${err.message}`)}\n${palette.dim(err.stack ?? '')}`.trimEnd();
  }
  return palette.red(`✘ ${String(err)}`);
}

/** Wrap a command body with the CLI's one error presentation; returns the process exit code. */
export async function runGuarded(context: CliContext, body: () => Promise<number>): Promise<number> {
  try {
    return await body();
  } catch (err) {
    context.writeErr(context.formatError(err));
    return 1;
  }
}

/** Throw a StarlingError from a command without importing the error type at each call site. */
export function fail(
  message: string,
  code: 'INVALID_ARGUMENT' | 'CONFIG_INVALID' = 'INVALID_ARGUMENT',
): never {
  throw new StarlingError(code, message);
}
