import { basename } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { CliContext } from '../context';
import {
  type DetectedProfile,
  detectHardware,
  detectProfile,
  type HardwareInfo,
  initConfig,
  type ModelProfile,
} from '../init';
import { failWith, readBoolean, readNumber, readString } from './options';

const PROFILES = ['auto', 'opencode', 'deepseek', 'local'] as const;
const PROFILE_LABEL: Record<ModelProfile, string> = {
  opencode: 'opencode-go (no API key needed)',
  deepseek: 'deepseek API (DEEPSEEK_API_KEY)',
  local: 'local Ollama (--fully-open)',
};

/** One question, default in brackets. Injected by tests; the real one reads the terminal. */
export type AskFn = (question: string, fallback: string) => Promise<string>;

export interface InitCommandOverrides {
  ask?: AskFn;
  hardware?: HardwareInfo;
  detected?: DetectedProfile;
  /** Defaults to `context.io.isTTY`. `--yes`, or a pipe, skips every question. */
  interactive?: boolean;
}

/**
 * `starling init` — write a commented, profile-aware `starling.config.yaml`.
 *
 * Interactive on a TTY (three questions, every one with a detected default), `--yes` for the
 * defaults, `--dry-run` to see the file without writing it. A non-TTY (CI, a pipe) behaves like
 * `--yes` so scripts never hang.
 */
export async function initCommand(
  options: Record<string, unknown>,
  context: CliContext,
  overrides: InitCommandOverrides = {},
): Promise<number> {
  const requested = readString(options, 'profile') ?? 'auto';
  if (!(PROFILES as readonly string[]).includes(requested)) {
    failWith('INVALID_ARGUMENT', `--profile must be one of ${PROFILES.join(', ')}`);
  }

  const dryRun = readBoolean(options, 'dryRun');
  const hardware =
    overrides.hardware ??
    (await detectHardware({ execFn: context.execFn, cwd: context.cwd, platform: process.platform }));
  const detected =
    overrides.detected ??
    (await detectProfile({ execFn: context.execFn, env: context.env, cwd: context.cwd }));

  let profile: ModelProfile | 'auto' = requested as ModelProfile | 'auto';
  let maxParallel = readNumber(options, 'maxParallel', hardware.suggestedMaxParallel);
  let flockEnabled = readBoolean(options, 'flock', true);

  const interactive = (overrides.interactive ?? context.io.isTTY) && !readBoolean(options, 'yes');
  if (interactive) {
    announce(context, detected, hardware);
    const prompter = overrides.ask === undefined ? openPrompter() : { ask: overrides.ask, close: noop };
    try {
      profile = await askProfile(prompter.ask, profile === 'auto' ? detected.profile : profile);
      maxParallel = await askPositive(prompter.ask, 'maxParallel (agents at once)', maxParallel);
      flockEnabled = await askBoolean(prompter.ask, 'enable flock (lend/borrow LAN agents)', flockEnabled);
    } finally {
      await prompter.close();
    }
  }

  const result = await initConfig({
    cwd: context.cwd,
    force: readBoolean(options, 'force'),
    profile,
    maxParallel,
    flockEnabled,
    dryRun,
    execFn: context.execFn,
    env: context.env,
    hardware,
    detected,
  });

  const label = PROFILE_LABEL[result.profile];
  const verb = dryRun ? 'would write' : result.overwrote ? 'overwrote' : 'wrote';
  context.write(
    `${context.palette.green('✔')} ${verb} ${context.palette.bold(basename(result.path))}  ${context.palette.dim(`profile ${label}`)}`,
  );
  context.write(
    `  ${context.palette.dim('maxParallel')} ${result.maxParallel}   ${context.palette.dim('flock')} ${result.flockEnabled ? 'on' : 'off'}   ${context.palette.dim('path')} ${result.path}`,
  );

  if (dryRun) {
    context.write();
    context.write(context.palette.dim('── dry run: nothing written ─────────────────────────────'));
    context.write(result.yaml);
    context.write(context.palette.dim(`rerun without --dry-run to write ${basename(result.path)}`));
    return 0;
  }

  context.write();
  context.write(context.palette.dim('Next:'));
  context.write(`  starling doctor                       ${context.palette.dim('check this machine')}`);
  context.write(`  starling plan "add dark mode"          ${context.palette.dim('see the task DAG')}`);
  context.write(`  starling run "add dark mode"           ${context.palette.dim('launch the flock')}`);
  context.write(`  starling dash                          ${context.palette.dim('watch it live')}`);
  return 0;
}

function announce(context: CliContext, detected: DetectedProfile, hardware: HardwareInfo): void {
  context.write(
    `${context.palette.bold('Starling init')} ${context.palette.dim('— three questions, then a working config')}`,
  );
  const source =
    detected.profile === 'opencode' && detected.opencodeModel !== undefined
      ? `opencode · ${detected.opencodeModel}`
      : detected.profile === 'deepseek'
        ? 'deepseek · DEEPSEEK_API_KEY is set'
        : 'local ollama · nothing detected';
  context.write(`  ${context.palette.dim('detected')}  ${source}`);
  context.write(
    `  ${context.palette.dim('hardware')}  ${hardware.cpuCores} cores · ${hardware.freeMemGb.toFixed(1)} GB free of ${hardware.totalMemGb.toFixed(0)} GB → ${hardware.suggestedMaxParallel} agents`,
  );
  context.write();
}

async function askProfile(ask: AskFn, fallback: ModelProfile): Promise<ModelProfile> {
  const answer = (await ask('model profile (opencode / deepseek / local)', fallback)).trim().toLowerCase();
  return (PROFILES as readonly string[]).includes(answer) && answer !== 'auto'
    ? (answer as ModelProfile)
    : fallback;
}

async function askPositive(ask: AskFn, label: string, fallback: number): Promise<number> {
  const answer = (await ask(label, String(fallback))).trim();
  const parsed = Number(answer);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function askBoolean(ask: AskFn, label: string, fallback: boolean): Promise<boolean> {
  const answer = (await ask(`${label} (y/n)`, fallback ? 'y' : 'n')).trim().toLowerCase();
  if (answer === 'y' || answer === 'yes') return true;
  if (answer === 'n' || answer === 'no') return false;
  return fallback;
}

interface Prompter {
  ask: AskFn;
  close(): Promise<void>;
}

function openPrompter(): Prompter {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: async (question, fallback) => {
      const answer = (await rl.question(`${question} [${fallback}] `)).trim();
      return answer.length === 0 ? fallback : answer;
    },
    close: async () => {
      rl.close();
    },
  };
}

async function noop(): Promise<void> {}
