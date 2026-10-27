/**
 * Test/lint command detection.
 *
 * A map without a test command is much less useful to the auditor, so this module makes a good
 * guess from the files a repo already has. Precedence is deliberate and documented here and in
 * `docs/epic-11-repomap.md`:
 *
 * **testCommand**
 * 1. `package.json` with a `scripts.test` entry — runner from the lockfile (bun/pnpm/yarn/npm).
 * 2. Python pytest signals: `[tool.pytest]` in `pyproject.toml`, `pytest.ini`, `[pytest]` in
 *    `tox.ini`/`setup.cfg`, or a `tests/` tree containing `test_*.py` / `*_test.py`.
 * 3. `Cargo.toml` → `cargo test`.
 * 4. `go.mod` → `go test ./...`.
 * 5. `Makefile` with a `test:` target → `make test`.
 *
 * **lintCommand**
 * 1. `package.json` scripts, first of `lint`, `check`, `typecheck`.
 *
 * JS wins over the others because polyglot repos almost always mean "a JS app plus a vendored
 * tool"; if it has no test script we fall through rather than guessing. Python before Rust/Go is
 * arbitrary but stable; a repo with both is rare and either answer is defensible. Make is last
 * because it is the most generic escape hatch.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DetectedCommands {
  testCommand?: string;
  lintCommand?: string;
}

type Runner = 'bun' | 'pnpm' | 'yarn' | 'npm';

const MAX_CONFIG_BYTES = 256 * 1024;

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').slice(0, MAX_CONFIG_BYTES);
  } catch {
    // A missing or unreadable config is a detection fact, not a repo-map failure: detection
    // degrades to the next candidate instead of throwing.
    return undefined;
  }
}

function detectRunner(root: string): Runner {
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun';
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  // No lockfile: Starling itself runs on Bun and `bun run <script>` works in plain npm projects
  // too, so Bun is the least surprising default.
  return 'bun';
}

function testCommandFor(runner: Runner): string {
  switch (runner) {
    case 'bun':
      return 'bun run test';
    case 'pnpm':
      return 'pnpm test';
    case 'yarn':
      return 'yarn test';
    case 'npm':
      return 'npm test';
  }
}

function runScript(runner: Runner, script: string): string {
  return `${runner} run ${script}`;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

function readPackageScripts(root: string): Record<string, string> | undefined {
  const raw = readIfPresent(join(root, 'package.json'));
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw) as PackageJson;
    if (parsed.scripts === undefined || parsed.scripts === null) return {};
    if (typeof parsed.scripts !== 'object') return {};
    const scripts: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed.scripts)) {
      if (typeof value === 'string' && value.trim().length > 0) scripts[key] = value.trim();
    }
    return scripts;
  } catch {
    // Malformed package.json: keep mapping the repo, just without JS commands.
    return undefined;
  }
}

function hasPythonTests(root: string, paths: readonly string[], pyproject: string | undefined): boolean {
  if (pyproject?.includes('[tool.pytest')) return true;

  if (existsSync(join(root, 'pytest.ini'))) return true;

  const tox = readIfPresent(join(root, 'tox.ini'));
  if (tox !== undefined && /^\s*\[pytest\]/m.test(tox)) return true;
  const setupCfg = readIfPresent(join(root, 'setup.cfg'));
  if (setupCfg !== undefined && /^\s*\[tool:pytest\]/m.test(setupCfg)) return true;

  return paths.some((path) => {
    if (!path.endsWith('.py')) return false;
    const base = path.split('/').at(-1) ?? '';
    return /^test_.*\.py$/.test(base) || /_test\.py$/.test(base) || path.startsWith('tests/');
  });
}

function hasMakeTestTarget(root: string): boolean {
  const makefile = readIfPresent(join(root, 'Makefile')) ?? readIfPresent(join(root, 'makefile'));
  if (makefile === undefined) return false;
  return /^test\s*:(?!=)/m.test(makefile);
}

/** Detect `testCommand`/`lintCommand` for an already-listed repo. Pure apart from root reads. */
export function detectCommands(root: string, paths: readonly string[]): DetectedCommands {
  const scripts = readPackageScripts(root);
  const runner = detectRunner(root);

  let testCommand: string | undefined;
  if (scripts?.test !== undefined) {
    testCommand = testCommandFor(runner);
  } else if (hasPythonTests(root, paths, readIfPresent(join(root, 'pyproject.toml')))) {
    testCommand = 'pytest';
  } else if (existsSync(join(root, 'Cargo.toml'))) {
    testCommand = 'cargo test';
  } else if (existsSync(join(root, 'go.mod'))) {
    testCommand = 'go test ./...';
  } else if (hasMakeTestTarget(root)) {
    testCommand = 'make test';
  }

  let lintCommand: string | undefined;
  if (scripts !== undefined) {
    for (const script of ['lint', 'check', 'typecheck'] as const) {
      if (scripts[script] !== undefined) {
        lintCommand = runScript(runner, script);
        break;
      }
    }
  }

  return {
    ...(testCommand === undefined ? {} : { testCommand }),
    ...(lintCommand === undefined ? {} : { lintCommand }),
  };
}
