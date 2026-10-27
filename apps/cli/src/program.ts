import { Command } from 'commander';

/** The epic that will replace each stub, so `--help` doubles as the roadmap. */
const STUBS: Array<{
  name: string;
  args: string;
  options: Array<[string, string]>;
  epic: number;
  description: string;
}> = [
  {
    name: 'plan',
    args: '<goal>',
    options: [
      ['--repo <path>', 'repository to plan against'],
      ['--json', 'print the raw plan'],
    ],
    epic: 7,
    description: 'map a repo and print a validated task DAG with lanes',
  },
  {
    name: 'run',
    args: '<goal>',
    options: [
      ['--repo <path>', 'repository to run against'],
      ['--max-parallel <n>', 'maximum concurrent agents'],
      ['--github', 'sync the plan to GitHub issues and PRs'],
      ['--fully-open', 'run every role on local open-weight models'],
      ['--dry-run', 'plan only, do not launch agents'],
      ['--record <path>', 'record the run as JSONL'],
      ['--no-dash', 'do not open the dashboard'],
    ],
    epic: 12,
    description: 'launch the flock and merge passing work onto one integration branch',
  },
  {
    name: 'replay',
    args: '<file>',
    options: [['--speed <factor>', 'playback speed multiplier']],
    epic: 26,
    description: 'replay a recorded JSONL run with original timing',
  },
  {
    name: 'dash',
    args: '',
    options: [['--port <n>', 'dashboard port']],
    epic: 22,
    description: 'serve the web dashboard',
  },
  {
    name: 'perch',
    args: '',
    options: [
      ['--hub <url>', 'hub to join'],
      ['--code <code>', 'join code'],
      ['--port <n>', 'perch port'],
      ['--max-sessions <n>', 'session slots to lend'],
      ['--name <name>', 'name shown in the flock'],
    ],
    epic: 19,
    description: 'join the flock from this machine',
  },
  {
    name: 'flock',
    args: '',
    options: [],
    epic: 34,
    description: 'list nodes and print the join command',
  },
  {
    name: 'status',
    args: '[runId]',
    options: [],
    epic: 15,
    description: 'show the status of a run',
  },
  {
    name: 'doctor',
    args: '',
    options: [],
    epic: 40,
    description: 'check bun, git, opencode, ollama and API keys',
  },
  {
    name: 'init',
    args: '',
    options: [],
    epic: 41,
    description: 'write a starling.config.yaml',
  },
];

/** Build the CLI. Every command is a registered stub until its epic lands. */
export function createProgram(): Command {
  const program = new Command();
  program
    .name('starling')
    .description('One goal in, a murmuration of open-weight coding agents out. 🐦')
    .version('0.0.0', '-V, --version', 'print the Starling version');

  for (const stub of STUBS) {
    const command = program
      .command(`${stub.name}${stub.args === '' ? '' : ` ${stub.args}`}`)
      .description(stub.description);
    for (const [flags, description] of stub.options) command.option(flags, description);
    command.action(() => {
      // Stubs intentionally print rather than exit non-zero: `--help` and scripting stay friendly.
      console.log(`${stub.name}: not yet implemented (epic ${String(stub.epic).padStart(2, '0')})`);
    });
  }

  return program;
}
