import { describe, expect, test } from 'bun:test';
import { detectCommands } from './commands';
import { makeTempDir, removeDir, writeFiles } from './test-helpers';

async function detect(files: Record<string, string>): Promise<ReturnType<typeof detectCommands>> {
  const root = await makeTempDir();
  try {
    await writeFiles(root, files);
    return detectCommands(root, Object.keys(files));
  } finally {
    await removeDir(root);
  }
}

const PACKAGE = JSON.stringify({
  scripts: { test: 'bun test', lint: 'biome check .', check: 'tsc --noEmit', typecheck: 'tsc' },
});

describe('JavaScript / TypeScript command detection', () => {
  test('bun.lock picks bun and prefers lint over check/typecheck', async () => {
    const commands = await detect({ 'package.json': PACKAGE, 'bun.lock': '{}' });
    expect(commands.testCommand).toBe('bun run test');
    expect(commands.lintCommand).toBe('bun run lint');
  });

  test('pnpm-lock picks pnpm', async () => {
    const commands = await detect({ 'package.json': PACKAGE, 'pnpm-lock.yaml': 'lockfileVersion: 9' });
    expect(commands.testCommand).toBe('pnpm test');
    expect(commands.lintCommand).toBe('pnpm run lint');
  });

  test('yarn.lock picks yarn', async () => {
    const commands = await detect({ 'package.json': PACKAGE, 'yarn.lock': '' });
    expect(commands.testCommand).toBe('yarn test');
  });

  test('package-lock.json picks npm', async () => {
    const commands = await detect({ 'package.json': PACKAGE, 'package-lock.json': '{}' });
    expect(commands.testCommand).toBe('npm test');
  });

  test('no lockfile defaults to bun', async () => {
    const commands = await detect({ 'package.json': PACKAGE });
    expect(commands.testCommand).toBe('bun run test');
  });

  test('falls through lint → check → typecheck', async () => {
    const commands = await detect({
      'package.json': JSON.stringify({ scripts: { test: 'vitest', typecheck: 'tsc' } }),
    });
    expect(commands.testCommand).toBe('bun run test');
    expect(commands.lintCommand).toBe('bun run typecheck');
  });

  test('a JS repo without a test script falls through to other signals', async () => {
    const commands = await detect({
      'package.json': JSON.stringify({ scripts: { build: 'vite build' } }),
      'go.mod': 'module example.com/x',
    });
    expect(commands.testCommand).toBe('go test ./...');
    expect(commands.lintCommand).toBeUndefined();
  });
});

describe('non-JavaScript command detection', () => {
  test('pyproject pytest config wins', async () => {
    const commands = await detect({
      'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"\n',
    });
    expect(commands.testCommand).toBe('pytest');
  });

  test('a tests/ tree with test_*.py is enough', async () => {
    const commands = await detect({ 'tests/test_api.py': 'def test_x():\n    assert True\n' });
    expect(commands.testCommand).toBe('pytest');
  });

  test('Cargo.toml picks cargo test', async () => {
    const commands = await detect({ 'Cargo.toml': '[package]\nname = "x"\n' });
    expect(commands.testCommand).toBe('cargo test');
  });

  test('go.mod picks go test ./...', async () => {
    const commands = await detect({ 'go.mod': 'module example.com/x\n' });
    expect(commands.testCommand).toBe('go test ./...');
  });

  test('a Makefile test target is the last resort', async () => {
    const commands = await detect({ Makefile: 'build:\n\tgo build ./...\ntest:\n\tgo test ./...\n' });
    expect(commands.testCommand).toBe('make test');
  });

  test('Makefile variables are not test targets', async () => {
    const commands = await detect({ Makefile: 'test := ./bin/x\nbuild:\n\ttrue\n' });
    expect(commands.testCommand).toBeUndefined();
  });

  test('JS test script outranks Cargo and Go', async () => {
    const commands = await detect({
      'package.json': PACKAGE,
      'Cargo.toml': '[package]\nname = "x"\n',
      'go.mod': 'module example.com/x\n',
    });
    expect(commands.testCommand).toBe('bun run test');
  });

  test('an empty repo has no commands and does not throw', async () => {
    const commands = await detect({});
    expect(commands).toEqual({});
  });

  test('malformed package.json degrades instead of throwing', async () => {
    const commands = await detect({ 'package.json': '{ not json' });
    expect(commands).toEqual({});
  });
});
