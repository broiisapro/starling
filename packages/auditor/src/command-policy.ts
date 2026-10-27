/**
 * What the auditor is allowed to execute, and with which environment (SEC-11).
 *
 * The auditor runs repo-provided commands (`testCommand` from the repo map, `lintCommand` from the
 * detector) through `sh -c` by design: a repo's test command is often a shell line, and refusing to
 * run it would make the quality gate blind. That is an accepted risk (documented in
 * `docs/epic-103-auditor-r2.md`) which this module narrows without changing today's defaults:
 *
 * - `mode: 'any'` (default) runs whatever the repo map says, as before;
 * - `mode: 'allowlist'` runs only a known test/lint/typecheck command with no shell syntax;
 * - `mode: 'off'` runs nothing (the future `--no-tests`).
 *
 * Every mode scrubs secrets out of the child environment unless `scrubEnv: false`, because core
 * `exec` merges `opts.env` over `process.env` (`packages/core/src/exec.ts:35`): the only way to
 * remove a variable is to override it.
 */

export type CommandMode = 'any' | 'allowlist' | 'off';

export interface CommandPolicy {
  /** `any` = run the repo's command as-is; `allowlist` = only known command prefixes; `off` = never. */
  mode: CommandMode;
  /** Overrides `DEFAULT_ALLOWED_COMMANDS` in allowlist mode. Prefixes, matched at a word boundary. */
  allow?: string[];
  /** Clear secret-looking env vars in the child. Default true; explicit `false` opts out. */
  scrubEnv?: boolean;
}

export interface CommandEvaluation {
  allowed: boolean;
  /** Present when `allowed` is false; shown verbatim in the audit check. */
  reason?: string;
}

/** The default keeps every repo that works today working; only the environment is scrubbed. */
export const DEFAULT_COMMAND_POLICY: CommandPolicy = { mode: 'any', scrubEnv: true };

/**
 * Commands that are test/lint/typecheck shaped. A prefix only matches at a word boundary, so
 * `bun testy` is not `bun test`. Deliberately conservative: an allowlist that includes a general
 * interpreter (`bun run`, `python`, `sh`) is no allowlist at all.
 */
export const DEFAULT_ALLOWED_COMMANDS: readonly string[] = [
  'biome check',
  'bun run lint',
  'bun run test',
  'bun test',
  'bunx biome check',
  'bunx eslint',
  'bunx jest',
  'bunx tsc',
  'bunx vitest',
  'cargo fmt --check',
  'cargo test',
  'eslint',
  'go test',
  'go vet',
  'make lint',
  'make test',
  'npm run lint',
  'npm run test',
  'npm test',
  'npx biome check',
  'npx jest',
  'npx tsc',
  'npx vitest',
  'pnpm lint',
  'pnpm run test',
  'pnpm test',
  'pytest',
  'python -m pytest',
  'ruff check',
  'yarn lint',
  'yarn test',
] as const;

interface ShellPattern {
  pattern: RegExp;
  label: string;
}

/**
 * Shell syntax that can turn a single command into several (or reach the filesystem): rejected in
 * allowlist mode. `\r`/`\n` matter because `sh -c` treats a newline as a command separator.
 */
const SHELL_PATTERNS: readonly ShellPattern[] = [
  { pattern: /;/, label: ';' },
  { pattern: /&/, label: '&' },
  { pattern: /\|/, label: '|' },
  { pattern: /`/, label: 'backticks' },
  { pattern: /\$\(/, label: '$(…)' },
  { pattern: /[<>]/, label: 'redirection' },
  { pattern: /[\r\n]/, label: 'a new line' },
];

function summarise(items: readonly string[], limit = 6): string {
  if (items.length <= limit) return items.join(', ');
  return `${items.slice(0, limit).join(', ')}, …`;
}

function matchesPrefix(command: string, prefix: string): boolean {
  if (command === prefix) return true;
  return command.startsWith(`${prefix} `) || command.startsWith(`${prefix}\t`);
}

/**
 * Decide whether one command may run under `policy`.
 *
 * Allowlist mode requires a prefix match **and** the absence of `;`, `&`, `|`, backticks, `$(`,
 * redirections and newlines, so `bun test; curl evil` and `bun test && rm -rf .` are refused even
 * though both start with an allowed prefix.
 */
export function evaluateCommand(
  command: string,
  policy: CommandPolicy = DEFAULT_COMMAND_POLICY,
): CommandEvaluation {
  if (policy.mode === 'off') {
    return { allowed: false, reason: 'disabled by policy' };
  }
  if (policy.mode === 'any') return { allowed: true };

  const cmd = command.trim();
  if (cmd === '') return { allowed: false, reason: 'empty command' };
  for (const { pattern, label } of SHELL_PATTERNS) {
    if (pattern.test(cmd)) {
      return { allowed: false, reason: `contains shell syntax (${label})` };
    }
  }
  const allowed = policy.allow ?? DEFAULT_ALLOWED_COMMANDS;
  if (!allowed.some((prefix) => matchesPrefix(cmd, prefix))) {
    return {
      allowed: false,
      reason: `not in the allowlist (${summarise(allowed)})`,
    };
  }
  return { allowed: true };
}

/**
 * Environment overrides that remove credentials from a child process.
 *
 * Names are matched case-insensitively. `CI=1` is always set so tools take their non-interactive
 * path; it is the one addition, never a removal.
 */
export function scrubbedEnv(
  source: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const overrides: Record<string, string> = { CI: '1' };
  for (const name of Object.keys(source)) {
    if (isSecretEnvName(name)) overrides[name] = '';
  }
  return overrides;
}

const SECRET_NAME_PATTERNS: readonly RegExp[] = [
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /API_KEY/i,
  /_KEY$/i,
  /^GH_/i,
  /^GITHUB_/i,
  /^DEEPSEEK/i,
  /^OPENAI/i,
  /^ANTHROPIC/i,
];

/** True when an env var name looks like a credential the auditor must not hand to a repo command. */
export function isSecretEnvName(name: string): boolean {
  return SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/** Fill in the defaults; callers may pass a partial policy (mode omitted means `any`). */
export function resolveCommandPolicy(policy: Partial<CommandPolicy> = {}): CommandPolicy {
  return {
    mode: policy.mode ?? DEFAULT_COMMAND_POLICY.mode,
    scrubEnv: policy.scrubEnv ?? DEFAULT_COMMAND_POLICY.scrubEnv,
    ...(policy.allow === undefined ? {} : { allow: [...policy.allow] }),
  };
}
