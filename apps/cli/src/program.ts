import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { dashCommand } from './commands/dash';
import { doctorCommand } from './commands/doctor';
import { flockCommand } from './commands/flock';
import { initCommand } from './commands/init';
import { perchCommand } from './commands/perch';
import { planCommand } from './commands/plan';
import { replayCommand } from './commands/replay';
import { runCommand } from './commands/run';
import { statusCommand } from './commands/status';
import type { CliContext, CliDeps } from './context';
import { createCliContext, runGuarded } from './context';

export interface CreateProgramOptions {
  deps?: CliDeps;
  /** Test hook: record the parsed command instead of running it. */
  dispatch?: (command: string, args: unknown[], options: Record<string, unknown>) => Promise<number>;
  /** Where an action's exit code goes. Defaults to `process.exitCode`. */
  onExitCode?: (code: number) => void;
}

type Action = (args: unknown[], options: Record<string, unknown>, context: CliContext) => Promise<number>;

const EXAMPLES: Record<string, string> = {
  plan: `
Examples:
  $ starling plan "add dark mode and fix the overdue bug" --repo ../sky-todo
  $ starling plan "add CSV export" --json | jq '.plan.tasks[].key'
`,
  run: `
Examples:
  $ starling run "add dark mode and fix the overdue bug" --repo ../sky-todo
  $ starling run "add CSV export" --record run.jsonl --no-dash
  $ starling run "harden the parser" --dry-run
`,
  replay: `
Examples:
  $ starling replay fixtures/runs/sky-todo-launch-day.jsonl
  $ starling replay run.jsonl --speed 20
`,
  dash: `
Examples:
  $ starling dash
  $ starling dash --port 8080
`,
  perch: `
Examples:
  $ starling perch --hub http://192.168.1.20:7777 --code STAR-LING
  $ starling perch --name "M2 Air" --max-sessions 5
`,
  flock: `
Examples:
  $ starling flock
  $ starling flock --json | jq '.nodes[] | {id, m: .maxSessions}'
`,
  status: `
Examples:
  $ starling status
  $ starling status --file run.jsonl
  $ starling status 01jd2k7m3p4q5r6s7t8v9w0x1y --json
`,
  doctor: `
Examples:
  $ starling doctor
  $ starling doctor --json | jq '.checks[] | select(.status != "ok")'
`,
  init: `
Examples:
  $ starling init
  $ starling init --yes
  $ starling init --dry-run --profile local
  $ starling init --yes --force
`,
};

/** Build the CLI. Actions are thin: every command's logic lives in `src/commands/`. */
export function createProgram(options: CreateProgramOptions = {}): Command {
  const deps = options.deps ?? {};
  const program = new Command();
  program
    .name('starling')
    .description('One goal in, a murmuration of open-weight coding agents out. 🐦')
    .version('0.0.0', '-V, --version', 'print the Starling version')
    .showHelpAfterError('(add --help for usage)')
    .addHelpText(
      'after',
      `
Examples:
  $ starling plan "add dark mode" --repo ../sky-todo
  $ starling run "add dark mode" --max-parallel 8 --record run.jsonl
  $ starling replay fixtures/runs/sky-todo-launch-day.jsonl --speed 200
  $ starling perch --hub http://192.168.1.20:7777 --code STAR-LING
  $ starling doctor

Wave 1 runs on the mock composition; real wiring lands in Epic 40.
`,
    );
  program.exitOverride();
  if (deps.io?.write !== undefined) {
    const write = deps.io.write;
    program.configureOutput({ writeOut: write, writeErr: write });
  }

  const register = (
    name: string,
    signature: string,
    description: string,
    action: Action,
    configure: (command: Command) => void,
  ): void => {
    const command = program
      .command(`${name}${signature.length === 0 ? '' : ` ${signature}`}`)
      .description(description);
    configure(command);
    command.addHelpText('after', EXAMPLES[name] ?? '');
    command.action(async (...raw: unknown[]) => {
      const commanderCommand = raw.at(-1) as Command;
      const args = raw.slice(0, Math.max(0, raw.length - 2));
      const parsed = commanderCommand.opts<Record<string, unknown>>();
      let code: number;
      if (options.dispatch !== undefined) {
        code = await options.dispatch(name, args, parsed);
      } else {
        const context = createCliContext(deps);
        code = await runGuarded(context, () => action(args, parsed, context));
      }
      if (options.onExitCode !== undefined) options.onExitCode(code);
      else process.exitCode = code;
    });
  };

  register(
    'plan',
    '<goal>',
    'map a repo and print a validated task DAG with lanes',
    (args, parsed, context) => planCommand(String(args[0] ?? ''), parsed, context),
    (command) => {
      command
        .option('--repo <path>', 'repository to plan against', '.')
        .option('--json', 'print the plan and lane issues as JSON');
    },
  );

  register(
    'run',
    '<goal>',
    'launch the flock and merge passing work onto one integration branch',
    (args, parsed, context) => runCommand(String(args[0] ?? ''), parsed, context),
    (command) => {
      command
        .option('--repo <path>', 'repository to run against', '.')
        .option('--max-parallel <n>', 'maximum concurrent agents', parsePositiveInt)
        .option('--github', 'sync the plan to GitHub issues and PRs')
        .option('--fully-open', 'run every role on local open-weight models')
        .option('--dry-run', 'plan only, do not launch agents')
        .option('--record <path>', 'append every event to a JSONL recording')
        .option('--no-dash', 'do not print the dashboard URL');
    },
  );

  register(
    'replay',
    '<file>',
    'replay a recorded JSONL run with original timing',
    (args, parsed, context) => replayCommand(String(args[0] ?? ''), parsed, context),
    (command) => {
      command.option('--speed <factor>', 'playback speed multiplier', parseSpeed, 4);
    },
  );

  register(
    'dash',
    '',
    'serve the web dashboard',
    (_args, parsed, context) => dashCommand(parsed, context),
    (command) => {
      command.option('--port <n>', 'dashboard port', parsePositiveInt);
    },
  );

  register(
    'perch',
    '',
    'join the flock from this machine',
    (_args, parsed, context) => perchCommand(parsed, context),
    (command) => {
      command
        .option('--hub <url>', 'hub to join, e.g. http://192.168.1.20:7777')
        .option('--code <code>', 'join code printed by the hub')
        .option('--port <n>', 'perch port', parsePositiveInt)
        .option('--max-sessions <n>', 'session slots to lend', parsePositiveInt)
        .option('--name <name>', 'name shown in the flock');
    },
  );

  register(
    'flock',
    '',
    'list nodes and print the join command',
    (_args, parsed, context) => flockCommand(parsed, context),
    (command) => {
      command.option('--json', 'print the roster and join info as JSON');
    },
  );

  register(
    'status',
    '[runId]',
    'show the status of a run',
    (args, parsed, context) =>
      statusCommand(args[0] === undefined ? undefined : String(args[0]), parsed, context),
    (command) => {
      command
        .option('--json', 'print the run as JSON')
        .option('--file <path>', 'read a recorded JSONL run instead of the live store');
    },
  );

  register(
    'doctor',
    '',
    'check bun, git, opencode, ollama, ports and keys',
    (_args, parsed, context) => doctorCommand(parsed, context),
    (command) => {
      command.option('--json', 'print one JSON object instead of the report');
    },
  );

  register(
    'init',
    '',
    'write a starling.config.yaml for this machine',
    (_args, parsed, context) => initCommand(parsed, context),
    (command) => {
      command
        .option('--yes', 'accept every detected default without asking')
        .option('--dry-run', 'print the config instead of writing it')
        .option('--force', 'overwrite an existing starling.config.yaml')
        .option('--max-parallel <n>', 'agents to run at once', parsePositiveInt)
        .option('--no-flock', 'write flock.enabled: false (single machine)')
        .addOption(
          new Option('--profile <profile>', 'model profile to write')
            .choices(['auto', 'opencode', 'deepseek', 'local'])
            .default('auto'),
        );
    },
  );

  return program;
}

/**
 * Parse argv and return the exit code. Commander is put in `exitOverride` mode so tests and embedding
 * callers never lose control of the process; help and version still exit 0.
 */
export async function main(argv: string[] = process.argv, deps: CliDeps = {}): Promise<number> {
  const program = createProgram({ deps });
  try {
    await program.parseAsync(argv);
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (err) {
    if (err instanceof CommanderError) return typeof err.exitCode === 'number' ? err.exitCode : 1;
    throw err;
  }
}

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return parsed;
}

function parseSpeed(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('must be a number greater than 0');
  }
  return parsed;
}
