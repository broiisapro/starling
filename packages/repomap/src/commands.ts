/**
 * Test/lint command detection.
 *
 * A map without a test command is much less useful to the auditor, so this module makes a good
 * guess from the files a repo already has. The precedence is deliberate; every rule below was
 * checked by hand against a real repo (see `bench/real-repos.ts`):
 *
 * **testCommand**
 * 1. The repo's own package manager:
 *    - `package.json` `scripts.test` — runner from the lockfile (bun/pnpm/yarn/npm);
 *    - a declared workspace with no root test script → recursive (`pnpm -r test`, …);
 *    - nested packages (`apps/<x>/package.json`) with no root test script → the biggest one
 *      (`yarn --cwd apps/<x> test`), which is how a Vite/React app tree is actually tested.
 * 2. Python: a declared task script (`pdm`/`poe`/`hatch`), then pytest configuration, then a
 *    `runtests.py` harness, then a `tests/` tree of `test_*.py`.
 * 3. `Cargo.toml` → `cargo test` (`--workspace` for a virtual workspace).
 * 4. `go.mod` → `go test ./...`.
 * 5. `Makefile` / `justfile` `test` target.
 *
 * **lintCommand**
 * 1. `package.json` scripts, first of `lint`, `check`, `typecheck` (or the nested-package form).
 * 2. A `Makefile` / `justfile` `lint` target.
 *
 * JavaScript only wins when the repo is *actually* JavaScript: a `package.json` whose `test` script
 * runs Grunt, in a checkout that is 97% Python, is tooling, not the test suite (Django is the
 * canonical case). Otherwise the dominant language's runner wins. Python lint is deliberately not
 * guessed — black, ruff, flake8 and isort all look alike from the outside, and a wrong lint command
 * is worse than none.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { langForPath } from './languages';

export interface DetectedCommands {
  testCommand?: string;
  lintCommand?: string;
}

type Runner = 'bun' | 'pnpm' | 'yarn' | 'npm';

const MAX_CONFIG_BYTES = 256 * 1024;

/** At or above this share of code files, the JS toolchain *is* the project. */
const JS_DOMINANCE = 0.5;

/** Languages that can host a test suite. Shell, SQL, CSS and docs cannot. */
const CODE_LANGUAGES: ReadonlySet<string> = new Set([
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'swift',
  'kotlin',
  'java',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'scala',
  'dart',
  'elixir',
  'erlang',
  'haskell',
  'clojure',
  'lua',
  'r',
  'julia',
]);

const JS_LANGUAGES: ReadonlySet<string> = new Set(['typescript', 'javascript']);

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8').slice(0, MAX_CONFIG_BYTES);
  } catch {
    // A missing or unreadable config is a detection fact, not a repo-map failure: detection
    // degrades to the next candidate instead of throwing.
    return undefined;
  }
}

function hasLockfile(dir: string): boolean {
  return (
    existsSync(join(dir, 'bun.lock')) ||
    existsSync(join(dir, 'bun.lockb')) ||
    existsSync(join(dir, 'pnpm-lock.yaml')) ||
    existsSync(join(dir, 'yarn.lock')) ||
    existsSync(join(dir, 'package-lock.json'))
  );
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
  workspaces?: unknown;
}

function parsePackageJson(dir: string): PackageJson | undefined {
  const raw = readIfPresent(join(dir, 'package.json'));
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as PackageJson;
  } catch {
    // Malformed package.json: keep mapping the repo, just without JS commands.
    return undefined;
  }
}

function readPackageScripts(root: string): Record<string, string> | undefined {
  const parsed = parsePackageJson(root);
  if (parsed === undefined) return undefined;
  const scripts: Record<string, string> = {};
  if (parsed.scripts !== undefined && parsed.scripts !== null && typeof parsed.scripts === 'object') {
    for (const [key, value] of Object.entries(parsed.scripts)) {
      if (typeof value === 'string' && value.trim().length > 0) scripts[key] = value.trim();
    }
  }
  return scripts;
}

function lintFromScripts(scripts: Record<string, string> | undefined, runner: Runner): string | undefined {
  if (scripts === undefined) return undefined;
  for (const script of ['lint', 'check', 'typecheck'] as const) {
    if (scripts[script] !== undefined) return runScript(runner, script);
  }
  return undefined;
}

/** Share of code files that are JS/TS. 1 when the repo has no code files at all. */
export function jsFileShare(paths: readonly string[]): number {
  let code = 0;
  let js = 0;
  for (const path of paths) {
    const lang = langForPath(path);
    if (!CODE_LANGUAGES.has(lang)) continue;
    code += 1;
    if (JS_LANGUAGES.has(lang)) js += 1;
  }
  return code === 0 ? 1 : js / code;
}

function hasWorkspaceDeclaration(root: string, parsed: PackageJson | undefined): boolean {
  if (existsSync(join(root, 'pnpm-workspace.yaml'))) return true;
  if (parsed?.workspaces !== undefined) return true;
  return existsSync(join(root, 'lerna.json'));
}

function recursiveTestCommand(runner: Runner): string {
  switch (runner) {
    case 'bun':
      return "bun run --filter '*' test";
    case 'pnpm':
      return 'pnpm -r test';
    case 'yarn':
      return 'yarn workspaces run test';
    case 'npm':
      return 'npm test --workspaces --if-present';
  }
}

interface NestedChoice {
  dir: string;
  runner: Runner;
  scripts: Record<string, string>;
}

/**
 * The biggest nested package that has its own test script. This is how a repo of apps is tested:
 * `bulletproof-react` has no root scripts and three `apps/*` each with a lockfile and a vitest suite.
 */
function pickNestedPackage(
  root: string,
  paths: readonly string[],
  rootRunner: Runner,
): NestedChoice | undefined {
  const dirs = new Set<string>();
  for (const path of paths) {
    if (path === 'package.json' || !path.endsWith('/package.json')) continue;
    const dir = path.slice(0, -'package.json'.length - 1);
    if (dir.split('/').length <= 2) dirs.add(dir);
  }

  const candidates = [...dirs]
    .map((dir): (NestedChoice & { files: number }) | undefined => {
      const scripts = readPackageScripts(join(root, dir));
      if (scripts === undefined || scripts.test === undefined) return undefined;
      const runner = hasLockfile(join(root, dir)) ? detectRunner(join(root, dir)) : rootRunner;
      const files = paths.filter((path) => path.startsWith(`${dir}/`)).length;
      return { dir, runner, scripts, files };
    })
    .filter((candidate): candidate is NestedChoice & { files: number } => candidate !== undefined)
    .sort((a, b) => b.files - a.files || (a.dir < b.dir ? -1 : 1));

  const best = candidates[0];
  return best === undefined ? undefined : { dir: best.dir, runner: best.runner, scripts: best.scripts };
}

/** Run one package's script from the repo root: `yarn --cwd apps/x test`. */
function packageScriptCommand(runner: Runner, dir: string, script: string): string {
  switch (runner) {
    case 'yarn':
      return `yarn --cwd ${dir} ${script}`;
    case 'pnpm':
      return `pnpm --dir ${dir} ${script}`;
    case 'npm':
      return `npm --prefix ${dir} run ${script}`;
    case 'bun':
      return `bun --cwd ${dir} run ${script}`;
  }
}

function nestedLintScript(scripts: Record<string, string>): string | undefined {
  for (const script of ['lint', 'check', 'typecheck'] as const) {
    if (scripts[script] !== undefined) return script;
  }
  return undefined;
}

/** Return the body of the first `[table]` whose header matches, up to the next header. */
function tomlTable(text: string, header: RegExp): string | undefined {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => header.test(line));
  if (start === -1) return undefined;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[/.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

function hasTomlKey(block: string | undefined, key: string): boolean {
  if (block === undefined) return false;
  return new RegExp(`^\\s*${key}\\s*=`, 'm').test(block);
}

/** An explicitly declared Python task, e.g. `[tool.pdm.scripts] test = "pytest"`. */
function pythonTaskScript(pyproject: string | undefined): string | undefined {
  if (pyproject === undefined) return undefined;
  if (hasTomlKey(tomlTable(pyproject, /^\s*\[tool\.pdm\.scripts\]\s*$/), 'test')) return 'pdm run test';
  if (hasTomlKey(tomlTable(pyproject, /^\s*\[tool\.poe\.tasks\]\s*$/), 'test')) return 'poe test';
  if (hasTomlKey(tomlTable(pyproject, /^\s*\[tool\.hatch\.envs\.[^\]]+\.scripts\]\s*$/), 'test')) {
    return 'hatch run test';
  }
  return undefined;
}

function hasPytestConfig(root: string, pyproject: string | undefined): boolean {
  if (pyproject?.includes('[tool.pytest')) return true;
  if (existsSync(join(root, 'pytest.ini'))) return true;
  const tox = readIfPresent(join(root, 'tox.ini'));
  if (tox !== undefined && /^\s*\[pytest\]/m.test(tox)) return true;
  const setupCfg = readIfPresent(join(root, 'setup.cfg'));
  if (setupCfg !== undefined && /^\s*\[tool:pytest\]/m.test(setupCfg)) return true;
  return false;
}

function isPythonTestPath(path: string): boolean {
  if (!path.endsWith('.py')) return false;
  const base = path.split('/').at(-1) ?? '';
  return /^test_.*\.py$/.test(base) || /_test\.py$/.test(base) || path.startsWith('tests/');
}

function pythonTestCommand(
  root: string,
  paths: readonly string[],
  pyproject: string | undefined,
): string | undefined {
  const declared = pythonTaskScript(pyproject);
  if (declared !== undefined) return declared;
  if (hasPytestConfig(root, pyproject)) return 'pytest';
  // Django/numpy-style harness: `python tests/runtests.py` runs the whole suite; pytest would not.
  if (existsSync(join(root, 'tests/runtests.py'))) return 'python tests/runtests.py';
  if (existsSync(join(root, 'runtests.py'))) return 'python runtests.py';
  if (paths.some(isPythonTestPath)) return 'pytest';
  return undefined;
}

function cargoTestCommand(root: string): string | undefined {
  const cargo = readIfPresent(join(root, 'Cargo.toml'));
  if (cargo === undefined) return undefined;
  // A virtual manifest (`[workspace]` without `[package]`) needs the explicit flag, and it is also
  // correct for a root package that is a workspace root: `cargo test` alone would skip the members.
  return /^\s*\[workspace\]/m.test(cargo) ? 'cargo test --workspace' : 'cargo test';
}

function makeTarget(root: string, target: string): boolean {
  const makefile =
    readIfPresent(join(root, 'Makefile')) ??
    readIfPresent(join(root, 'makefile')) ??
    readIfPresent(join(root, 'GNUmakefile'));
  if (makefile === undefined) return false;
  return new RegExp(`^${target}\\s*:(?!=)`, 'm').test(makefile);
}

function justTarget(root: string, target: string): boolean {
  for (const name of ['justfile', 'Justfile', '.justfile']) {
    const text = readIfPresent(join(root, name));
    if (text === undefined) continue;
    if (new RegExp(`^${target}(?:[ \\t][^:]*)?:`, 'm').test(text)) return true;
  }
  return false;
}

/** Detect `testCommand`/`lintCommand` for an already-listed repo. Pure apart from root reads. */
export function detectCommands(root: string, paths: readonly string[]): DetectedCommands {
  const parsed = parsePackageJson(root);
  const scripts = readPackageScripts(root);
  const runner = detectRunner(root);
  const pyproject = readIfPresent(join(root, 'pyproject.toml'));
  const jsDominant = jsFileShare(paths) >= JS_DOMINANCE;

  const nested =
    scripts !== undefined && scripts.test === undefined && !hasWorkspaceDeclaration(root, parsed)
      ? pickNestedPackage(root, paths, runner)
      : undefined;

  let jsTest: string | undefined;
  if (scripts?.test !== undefined) {
    jsTest = testCommandFor(runner);
  } else if (scripts !== undefined && hasWorkspaceDeclaration(root, parsed)) {
    jsTest = recursiveTestCommand(runner);
  } else if (nested !== undefined) {
    jsTest = packageScriptCommand(nested.runner, nested.dir, 'test');
  }

  const otherTest =
    pythonTestCommand(root, paths, pyproject) ??
    cargoTestCommand(root) ??
    (existsSync(join(root, 'go.mod')) ? 'go test ./...' : undefined) ??
    (makeTarget(root, 'test') ? 'make test' : undefined) ??
    (justTarget(root, 'test') ? 'just test' : undefined);

  const testCommand =
    jsTest !== undefined && (jsDominant || otherTest === undefined) ? jsTest : (otherTest ?? jsTest);

  const nestedLint =
    nested === undefined
      ? undefined
      : (() => {
          const script = nestedLintScript(nested.scripts);
          return script === undefined ? undefined : packageScriptCommand(nested.runner, nested.dir, script);
        })();
  const jsLint = lintFromScripts(scripts, runner) ?? nestedLint;
  const otherLint =
    (makeTarget(root, 'lint') ? 'make lint' : undefined) ??
    (justTarget(root, 'lint') ? 'just lint' : undefined);
  const lintCommand =
    jsLint !== undefined && (jsDominant || otherLint === undefined) ? jsLint : (otherLint ?? jsLint);

  return {
    ...(testCommand === undefined ? {} : { testCommand }),
    ...(lintCommand === undefined ? {} : { lintCommand }),
  };
}
