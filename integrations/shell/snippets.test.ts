/**
 * The snippets themselves: syntax-checked with each shell's own parser, and the bash one actually run
 * in an interactive shell with a fake helper, so "PROMPT_COMMAND ends up exporting STARLING_PROMPT" is
 * asserted rather than assumed.
 *
 * No shell is required to be installed: fish is often missing on a Mac, so the tests skip instead of
 * failing. Everything else here is offline, deterministic and quick.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = import.meta.dir;
const ZSH = Bun.which('zsh');
const BASH = Bun.which('bash') ?? '/bin/bash';
const FISH = Bun.which('fish');
const ZSH_SNIPPET = join(DIR, 'starling.zsh');
const BASH_SNIPPET = join(DIR, 'starling.bash');
const FISH_SNIPPET = join(DIR, 'starling.fish');
const SHIM = join(DIR, 'starling-prompt');

const ROOT = mkdtempSync(join(tmpdir(), 'starling-prompt-snippets-'));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

let counter = 0;

interface Sandbox {
  bin: string;
  cache: string;
  log: string;
  env: Record<string, string>;
}

/**
 * A fake `starling-prompt`: `--path` answers with the cache file, anything else appends its argv to a
 * log. Using a shell script (not bun) keeps these tests about the snippet, not about startup time.
 */
function sandbox(): Sandbox {
  counter += 1;
  const base = join(ROOT, `case-${counter}`);
  mkdirSync(base, { recursive: true });
  const bin = join(base, 'starling-prompt');
  const cache = join(base, 'prompt.txt');
  const log = join(base, 'calls.log');
  writeFileSync(
    bin,
    `#!/bin/sh\nif [ "$1" = "--path" ]; then\n  printf '%s\\n' "$STARLING_FAKE_PATH"\n  exit 0\nfi\nprintf '%s\\n' "$*" >> "$STARLING_FAKE_LOG"\n`,
  );
  chmodSync(bin, 0o755);
  writeFileSync(cache, '\u{1F426} 12/30');
  return {
    bin,
    cache,
    log,
    env: {
      STARLING_PROMPT_BIN: bin,
      STARLING_FAKE_PATH: cache,
      STARLING_FAKE_LOG: log,
      STARLING_HUB_URL: 'http://127.0.0.1:7777',
      STARLING_PROMPT: '',
      STARLING_PROMPT_ASCII: '',
    },
  };
}

function spawn(cmd: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawnSync({
    cmd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { code: proc.exitCode ?? -1, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

/** Backgrounded refreshes are async by design; poll the fake's log for at most a second. */
async function waitForLog(log: string, needle: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(log)) {
      const text = readFileSync(log, 'utf8');
      if (text.includes(needle)) return text;
    }
    await Bun.sleep(10);
  }
  return existsSync(log) ? readFileSync(log, 'utf8') : '';
}

describe('syntax', () => {
  test.skipIf(!ZSH)('zsh -n accepts starling.zsh', () => {
    const result = spawn([ZSH as string, '-n', ZSH_SNIPPET], {});
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  test('bash -n accepts starling.bash (including on bash 3.2)', () => {
    const result = spawn([BASH, '-n', BASH_SNIPPET], {});
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  test.skipIf(!FISH)('fish -n accepts starling.fish', () => {
    const result = spawn([FISH as string, '-n', FISH_SNIPPET], {});
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  test('sh -n accepts the starling-prompt shim', () => {
    const result = spawn(['/bin/sh', '-n', SHIM], {});
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });
});

describe('the bash snippet, for real', () => {
  test('PROMPT_COMMAND is chained, not replaced', () => {
    const box = sandbox();
    const script = [
      'PROMPT_COMMAND=": legacy"',
      `source ${JSON.stringify(BASH_SNIPPET)}`,
      'printf "%s" "$PROMPT_COMMAND"',
    ].join('; ');
    const result = spawn([BASH, '--norc', '--noprofile', '-i', '-c', script], box.env);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('_starling_prompt_cmd; : legacy');
  });

  test('running PROMPT_COMMAND exports STARLING_PROMPT from the cache', () => {
    const box = sandbox();
    const script = [
      `source ${JSON.stringify(BASH_SNIPPET)}`,
      'eval "$PROMPT_COMMAND"',
      'printf "%s" "$STARLING_PROMPT"',
    ].join('; ');
    const result = spawn([BASH, '--norc', '--noprofile', '-i', '-c', script], box.env);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('\u{1F426} 12/30');
  });

  test('the refresh is backgrounded, throttled and asks for bash escapes', async () => {
    const box = sandbox();
    const script = [
      `source ${JSON.stringify(BASH_SNIPPET)}`,
      '_starling_prompt_cmd',
      // A second call inside the same $SECONDS tick must not spawn another refresh.
      '_starling_prompt_cmd',
    ].join('; ');
    spawn([BASH, '--norc', '--noprofile', '-i', '-c', script], box.env);
    const log = await waitForLog(box.log, '--refresh');
    expect(log).toContain('--refresh');
    expect(log).toContain('--style bash');
    expect(log).toContain('--interval-ms 2000');
    expect(log.trim().split('\n')).toHaveLength(1);
  });

  test('STARLING_PROMPT_ASCII reaches the helper', async () => {
    const box = sandbox();
    const script = `source ${JSON.stringify(BASH_SNIPPET)}; _starling_prompt_cmd`;
    spawn([BASH, '--norc', '--noprofile', '-i', '-c', script], { ...box.env, STARLING_PROMPT_ASCII: '1' });
    const log = await waitForLog(box.log, '--refresh');
    expect(log).toContain('--ascii');
  });

  test('STARLING_PROMPT=off defines nothing at all', () => {
    const box = sandbox();
    const script = [
      `source ${JSON.stringify(BASH_SNIPPET)}`,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion in a bash string
      'printf "%s|%s" "${PROMPT_COMMAND:-none}" "${_STARLING_PROMPT_LOADED:-none}"',
    ].join('; ');
    const result = spawn([BASH, '--norc', '--noprofile', '-i', '-c', script], {
      ...box.env,
      STARLING_PROMPT: 'off',
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('none|none');
    expect(existsSync(box.log)).toBe(false);
  });
});

describe('the zsh snippet, for real', () => {
  test.skipIf(!ZSH)('precmd reads the cache into STARLING_PROMPT', () => {
    const box = sandbox();
    const script = [
      `source ${JSON.stringify(ZSH_SNIPPET)}`,
      '_starling_prompt_precmd',
      'print -rn -- "$STARLING_PROMPT"',
    ].join('; ');
    const result = spawn([ZSH as string, '-f', '-c', script], box.env);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('\u{1F426} 12/30');
  });

  test.skipIf(!ZSH)('the precmd hook is registered once, even when sourced twice', () => {
    const box = sandbox();
    const script = [
      `source ${JSON.stringify(ZSH_SNIPPET)}`,
      `source ${JSON.stringify(ZSH_SNIPPET)}`,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: zsh length expansion in a zsh string
      'print -rn -- "${#precmd_functions}"',
    ].join('; ');
    const result = spawn([ZSH as string, '-f', '-c', script], box.env);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('1');
  });

  test.skipIf(!ZSH)('a refresh is spawned with zsh escapes', async () => {
    const box = sandbox();
    const script = `source ${JSON.stringify(ZSH_SNIPPET)}; _starling_prompt_precmd`;
    spawn([ZSH as string, '-f', '-c', script], box.env);
    const log = await waitForLog(box.log, '--refresh');
    expect(log).toContain('--style zsh');
    expect(log).toContain('--interval-ms 2000');
  });

  test.skipIf(!ZSH)('STARLING_PROMPT=off leaves the prompt alone', () => {
    const box = sandbox();
    const script = [
      `source ${JSON.stringify(ZSH_SNIPPET)}`,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: zsh array expansion in a zsh string
      'print -rn -- "${precmd_functions[*]:-none}|${_STARLING_PROMPT_LOADED:-none}"',
    ].join('; ');
    const result = spawn([ZSH as string, '-f', '-c', script], { ...box.env, STARLING_PROMPT: 'off' });
    expect(result.code).toBe(0);
    expect(result.stdout).toBe('none|none');
    expect(existsSync(box.log)).toBe(false);
  });
});

describe('the snippets as shipped', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  test('every snippet backgrounds the refresh and discards its output', () => {
    for (const path of [ZSH_SNIPPET, BASH_SNIPPET, FISH_SNIPPET]) {
      const text = read(path);
      expect(text).toContain('--refresh');
      expect(text).toContain('/dev/null 2>&1 &');
    }
  });

  test('zsh and bash read the cache with a builtin (no fork per prompt)', () => {
    expect(read(ZSH_SNIPPET)).toContain('$(<"$_starling_prompt_path")');
    expect(read(BASH_SNIPPET)).toContain('IFS= read -r STARLING_PROMPT');
  });

  test('fish exports the documented function and the prompt event', () => {
    const text = read(FISH_SNIPPET);
    expect(text).toContain('function starling_prompt_segment');
    expect(text).toContain('--on-event fish_prompt');
    expect(text).toContain('fish_right_prompt');
  });

  test('all three document the opt-outs', () => {
    for (const path of [ZSH_SNIPPET, BASH_SNIPPET, FISH_SNIPPET]) {
      const text = read(path);
      expect(text).toContain('STARLING_PROMPT=off');
      expect(text).toContain('STARLING_PROMPT_ASCII=1');
      expect(text).toContain('NO_COLOR');
    }
  });

  test('no snippet builds a shell string from a URL or a token', () => {
    // Every helper invocation is an argv array (bash/zsh) or a fish list — never `eval`/`sh -c`.
    for (const path of [ZSH_SNIPPET, BASH_SNIPPET, FISH_SNIPPET]) {
      const text = read(path);
      expect(text).not.toContain('eval ');
      expect(text).not.toContain('sh -c');
      expect(text).not.toContain('bash -c');
    }
  });
});
