import { describe, expect, test } from 'bun:test';
import { CommanderError } from 'commander';
import { createProgram, main } from './program';

interface Captured {
  command: string;
  args: unknown[];
  options: Record<string, unknown>;
}

const noopIo = { write: (_text: string) => {} };

async function parse(args: string[]): Promise<{ captured: Captured; codes: number[]; output: string }> {
  let captured: Captured = { command: '', args: [], options: {} };
  const codes: number[] = [];
  let output = '';
  const program = createProgram({
    deps: { io: { write: (text) => (output += text) } },
    dispatch: async (command, commandArgs, options) => {
      captured = { command, args: commandArgs, options };
      return 0;
    },
    onExitCode: (code) => codes.push(code),
  });
  await program.parseAsync(['node', 'starling', ...args]);
  return { captured, codes, output };
}

async function parseError(args: string[]): Promise<CommanderError> {
  const program = createProgram({ deps: { io: noopIo }, onExitCode: () => {} });
  try {
    await program.parseAsync(['node', 'starling', ...args]);
  } catch (err) {
    if (err instanceof CommanderError) return err;
    throw err;
  }
  throw new Error(`expected ${args.join(' ')} to fail`);
}

describe('commander surface', () => {
  test('registers every locked command in order', () => {
    const program = createProgram({ deps: { io: noopIo } });
    expect(program.commands.map((command) => command.name())).toEqual([
      'plan',
      'run',
      'replay',
      'dash',
      'perch',
      'flock',
      'status',
      'doctor',
      'init',
    ]);
  });

  test('root help explains the pitch and examples', () => {
    let output = '';
    const program = createProgram({ deps: { io: { write: (text) => (output += text) } } });
    program.outputHelp();
    expect(output).toContain('murmuration');
    expect(output).toContain('--version');
    expect(output).toContain('starling replay fixtures/runs/sky-todo-launch-day.jsonl');
    expect(output).toContain('Wave 1 runs on the mock composition');
  });

  test('every command documents its examples', () => {
    let output = '';
    const program = createProgram({ deps: { io: { write: (text) => (output += text) } } });
    for (const name of ['plan', 'run', 'replay', 'dash', 'perch', 'flock', 'status', 'doctor', 'init']) {
      output = '';
      const command = program.commands.find((candidate) => candidate.name() === name);
      command?.outputHelp();
      expect(output).toContain('Examples:');
    }
  });

  test('plan parses a goal, --repo and --json', async () => {
    const { captured } = await parse(['plan', 'add dark mode', '--repo', '../sky-todo', '--json']);
    expect(captured.command).toBe('plan');
    expect(captured.args).toEqual(['add dark mode']);
    expect(captured.options).toMatchObject({ repo: '../sky-todo', json: true });
  });

  test('run parses every locked flag, including --no-dash', async () => {
    const { captured } = await parse([
      'run',
      'ship it',
      '--repo',
      '.',
      '--max-parallel',
      '4',
      '--github',
      '--fully-open',
      '--dry-run',
      '--record',
      'out.jsonl',
      '--no-dash',
    ]);
    expect(captured.command).toBe('run');
    expect(captured.options).toMatchObject({
      repo: '.',
      maxParallel: 4,
      github: true,
      fullyOpen: true,
      dryRun: true,
      record: 'out.jsonl',
      dash: false,
    });
  });

  test('run defaults dash to true', async () => {
    const { captured } = await parse(['run', 'ship it']);
    expect(captured.options.dash).toBe(true);
  });

  test('replay defaults speed to 4 and accepts a multiplier', async () => {
    const first = await parse(['replay', 'run.jsonl']);
    expect(first.captured.args).toEqual(['run.jsonl']);
    expect(first.captured.options.speed).toBe(4);

    const second = await parse(['replay', 'run.jsonl', '--speed', '200']);
    expect(second.captured.options.speed).toBe(200);
  });

  test('dash parses an optional port', async () => {
    expect((await parse(['dash'])).captured.options.port).toBeUndefined();
    expect((await parse(['dash', '--port', '8080'])).captured.options.port).toBe(8080);
  });

  test('perch parses all five flags', async () => {
    const { captured } = await parse([
      'perch',
      '--hub',
      'http://192.168.1.20:7777',
      '--code',
      'STAR-LING',
      '--port',
      '7788',
      '--max-sessions',
      '5',
      '--name',
      'M2 Air',
    ]);
    expect(captured.options).toMatchObject({
      hub: 'http://192.168.1.20:7777',
      code: 'STAR-LING',
      port: 7788,
      maxSessions: 5,
      name: 'M2 Air',
    });
  });

  test('flock parses --json', async () => {
    expect((await parse(['flock', '--json'])).captured.options.json).toBe(true);
  });

  test('status parses an optional runId, --json and --file', async () => {
    const { captured } = await parse(['status', '01jd2run', '--json', '--file', 'run.jsonl']);
    expect(captured.args).toEqual(['01jd2run']);
    expect(captured.options).toMatchObject({ json: true, file: 'run.jsonl' });

    const bare = await parse(['status']);
    expect(bare.captured.args).toEqual([]);
  });

  test('doctor takes no options', async () => {
    const { captured } = await parse(['doctor']);
    expect(captured.command).toBe('doctor');
    expect(captured.options).toEqual({});
  });

  test('init parses --force and --profile', async () => {
    const { captured } = await parse(['init', '--force', '--profile', 'local']);
    expect(captured.options).toMatchObject({ force: true, profile: 'local' });
    expect((await parse(['init'])).captured.options.profile).toBe('auto');
  });

  test('rejects an unknown --profile choice', async () => {
    const error = await parseError(['init', '--profile', 'gpt']);
    expect(error.exitCode).toBe(1);
  });

  test('rejects a non-numeric --max-parallel before any command runs', async () => {
    const error = await parseError(['run', 'ship it', '--max-parallel', 'many']);
    expect(error.exitCode).toBe(1);
    expect(String(error.message)).toContain('positive integer');
  });

  test('rejects an unknown command and an unknown flag', async () => {
    expect((await parseError(['fly'])).exitCode).toBe(1);
    expect((await parseError(['doctor', '--turbo'])).exitCode).toBe(1);
  });

  test('--help and --version exit 0 without running a command', async () => {
    const help = await parseError(['--help']);
    expect(help.exitCode).toBe(0);
    const version = await parseError(['--version']);
    expect(version.exitCode).toBe(0);
  });
});

describe('main()', () => {
  test('returns the dispatch exit code and never process.exits', async () => {
    let code = 0;
    const program = createProgram({
      deps: { io: noopIo },
      dispatch: async () => 7,
      onExitCode: (value) => (code = value),
    });
    await program.parseAsync(['node', 'starling', 'flock']);
    expect(code).toBe(7);
  });

  test('help through main() returns 0', async () => {
    const original = process.exitCode;
    expect(await main(['node', 'starling', '--help'], { io: noopIo })).toBe(0);
    process.exitCode = original;
  });
});
