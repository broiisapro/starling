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

  test('a Cargo workspace needs --workspace to cover every member', async () => {
    const commands = await detect({
      'Cargo.toml': '[workspace]\nmembers = ["core", "derive"]\n',
      'core/src/lib.rs': 'pub fn core() {}\n',
    });
    expect(commands.testCommand).toBe('cargo test --workspace');
  });

  test('go.mod picks go test ./...', async () => {
    const commands = await detect({ 'go.mod': 'module example.com/x\n' });
    expect(commands.testCommand).toBe('go test ./...');
  });

  test('a Makefile test target is the last resort', async () => {
    const commands = await detect({ Makefile: 'build:\n\tgo build ./...\ntest:\n\tgo test ./...\n' });
    expect(commands.testCommand).toBe('make test');
  });

  test('a Makefile lint target is the lint command when nothing else claims it', async () => {
    const commands = await detect({
      'go.mod': 'module example.com/x\n',
      Makefile: 'test:\n\tgo test ./...\nlint:\n\tgolangci-lint run\n',
    });
    expect(commands.testCommand).toBe('go test ./...');
    expect(commands.lintCommand).toBe('make lint');
  });

  test('Makefile variables are not test targets', async () => {
    const commands = await detect({ Makefile: 'test := ./bin/x\nbuild:\n\ttrue\n' });
    expect(commands.testCommand).toBeUndefined();
  });

  test('Makefile targets that merely start with "test" are not test targets', async () => {
    const commands = await detect({ Makefile: 'testing:\n\ttrue\n' });
    expect(commands.testCommand).toBeUndefined();
  });

  test('a justfile test recipe and lint recipe are detected', async () => {
    const commands = await detect({
      justfile: 'build:\n    cargo build\ntest:\n    cargo test\nlint:\n    cargo clippy\n',
    });
    expect(commands.testCommand).toBe('just test');
    expect(commands.lintCommand).toBe('just lint');
  });

  test('a justfile recipe with arguments is still the test recipe', async () => {
    const commands = await detect({ justfile: 'test filter="":\n    cargo test {{filter}}\n' });
    expect(commands.testCommand).toBe('just test');
  });

  test('a justfile recipe named testing is not a test recipe', async () => {
    const commands = await detect({ justfile: 'testing:\n    echo nope\n' });
    expect(commands.testCommand).toBeUndefined();
  });

  test('JS test script outranks Cargo and Go in a JavaScript repo', async () => {
    const commands = await detect({
      'package.json': PACKAGE,
      'src/a.ts': 'export const a = 1\n',
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

describe('the dominant language decides between a tooling package.json and the real suite', () => {
  test('a Python repo whose package.json runs grunt is tested with Python, not npm', async () => {
    const commands = await detect({
      'package.json': JSON.stringify({ scripts: { test: 'grunt test --verbose' } }),
      'tests/runtests.py': 'if __name__ == "__main__":\n    pass\n',
      'django/core.py': 'def run():\n    pass\n',
      'django/views.py': 'class View:\n    pass\n',
      'django/urls.py': 'def url():\n    pass\n',
    });
    expect(commands.testCommand).toBe('python tests/runtests.py');
    expect(commands.lintCommand).toBeUndefined();
  });

  test('a tests/runtests.py harness beats the generic pytest guess', async () => {
    const commands = await detect({
      'tests/runtests.py': '',
      'tests/test_one.py': 'def test_one():\n    pass\n',
    });
    expect(commands.testCommand).toBe('python tests/runtests.py');
  });

  test('a root runtests.py harness is used when tests/ has no runner', async () => {
    const commands = await detect({ 'runtests.py': '', 'mypkg/core.py': 'def f():\n    pass\n' });
    expect(commands.testCommand).toBe('python runtests.py');
  });

  test('explicit pytest configuration still wins over a runtests harness', async () => {
    const commands = await detect({
      'pyproject.toml': '[tool.pytest.ini_options]\n',
      'tests/runtests.py': '',
      'tests/test_one.py': 'def test_one():\n    pass\n',
    });
    expect(commands.testCommand).toBe('pytest');
  });

  test('a TypeScript repo keeps its package.json test even with a Makefile', async () => {
    const commands = await detect({
      'package.json': PACKAGE,
      Makefile: 'test:\n\tmake -C packages test\n',
      'src/a.ts': 'export const a = 1\n',
      'src/b.ts': 'export const b = 1\n',
    });
    expect(commands.testCommand).toBe('bun run test');
  });
});

describe('workspace and nested-package commands', () => {
  test('a pnpm workspace with no root test script runs the members', async () => {
    const commands = await detect({
      'package.json': JSON.stringify({ private: true, scripts: { build: 'tsup' } }),
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'packages/a/package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
      'packages/a/src/a.ts': 'export const a = 1\n',
    });
    expect(commands.testCommand).toBe('pnpm -r test');
  });

  test('a package.json with a workspaces field and no test script runs the members', async () => {
    const commands = await detect({
      'package.json': JSON.stringify({ private: true, workspaces: ['packages/*'] }),
      'packages/a/package.json': JSON.stringify({ scripts: { test: 'jest' } }),
      'packages/a/src/a.js': 'module.exports = 1\n',
    });
    expect(commands.testCommand).toBe('bun run --filter \'*\' test');
  });

  test('an app tree with no workspaces declaration uses its biggest app', async () => {
    const commands = await detect({
      'package.json': JSON.stringify({ private: true, scripts: { prepare: 'echo hi' } }),
      'apps/api/package.json': JSON.stringify({ scripts: { test: 'vitest' } }),
      'apps/api/src/api.ts': 'export const api = 1\n',
      'apps/web/package.json': JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .' } }),
      'apps/web/yarn.lock': '',
      'apps/web/src/main.tsx': 'export const Main = () => null\n',
      'apps/web/src/app.tsx': 'export const App = () => null\n',
    });
    expect(commands.testCommand).toBe('yarn --cwd apps/web test');
    expect(commands.lintCommand).toBe('yarn --cwd apps/web lint');
  });
});

describe('declared Python task scripts', () => {
  test('pdm scripts.test', async () => {
    const commands = await detect({
      'pyproject.toml': '[tool.pdm.scripts]\ntest = "pytest -q"\n',
      'pkg/core.py': 'def f():\n    pass\n',
    });
    expect(commands.testCommand).toBe('pdm run test');
  });

  test('poe tasks.test', async () => {
    const commands = await detect({
      'pyproject.toml': '[tool.poe.tasks]\ntest = "pytest -q"\n',
      'pkg/core.py': 'def f():\n    pass\n',
    });
    expect(commands.testCommand).toBe('poe test');
  });

  test('hatch env scripts.test', async () => {
    const commands = await detect({
      'pyproject.toml': '[tool.hatch.envs.default.scripts]\ntest = "pytest -q"\n',
      'pkg/core.py': 'def f():\n    pass\n',
    });
    expect(commands.testCommand).toBe('hatch run test');
  });

  test('a scripts table without a test key falls through', async () => {
    const commands = await detect({
      'pyproject.toml': '[tool.pdm.scripts]\nlint = "ruff check"\n',
      'tests/test_a.py': 'def test_a():\n    pass\n',
    });
    expect(commands.testCommand).toBe('pytest');
  });
});
