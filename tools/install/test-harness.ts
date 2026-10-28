/**
 * test-harness.ts — spawn the real installer in a throwaway HOME, never against a real host.
 *
 * Every test goes through `runInstaller`, which refuses a non-loopback `STARLING_RELEASE_BASE_URL`.
 * That is the guard that keeps the suite honest: the scripts' default host is GitHub, and a test
 * that forgot the override would be a network call. Here it would be a loud failure instead.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const INSTALL_SH = join(import.meta.dir, 'install.sh');
export const UNINSTALL_SH = join(import.meta.dir, 'uninstall.sh');

/** A loopback port that refuses connections: for assertions that no download happens. */
export const OFFLINE_BASE_URL = 'http://127.0.0.1:9';

export interface Sandbox {
  /** Temp root; removed by `cleanupSandbox`. */
  dir: string;
  home: string;
  tmp: string;
  installDir: string;
}

export interface ScriptResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function makeSandbox(): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), 'starling-install-test-'));
  const home = join(dir, 'home');
  const tmp = join(dir, 'tmp');
  mkdirSync(home, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  return { dir, home, tmp, installDir: join(home, '.starling') };
}

export function cleanupSandbox(sandbox: Sandbox): void {
  rmSync(sandbox.dir, { recursive: true, force: true });
}

function loopbackOnly(baseUrl: string): void {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)) {
    throw new Error(`tests must point STARLING_RELEASE_BASE_URL at loopback, got '${baseUrl}'`);
  }
}

function childEnv(overrides: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith('STARLING_')) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface RunOptions {
  args?: string[];
  env?: Record<string, string | undefined>;
  /** `sh` by default; pass the dash path to prove portability. */
  shell?: string;
  cwd?: string;
}

/** Run `sh <script> [args…]` and capture everything. */
export async function runSh(script: string, opts: RunOptions = {}): Promise<ScriptResult> {
  const shell = opts.shell ?? Bun.which('sh') ?? '/bin/sh';
  const proc = Bun.spawn([shell, script, ...(opts.args ?? [])], {
    env: childEnv(opts.env ?? {}),
    cwd: opts.cwd ?? import.meta.dir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

export interface InstallerRun {
  /** The fake release server's base URL (always loopback). */
  releaseBaseUrl: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  shell?: string;
}

/** Run install.sh with a sandbox HOME/TMPDIR and an explicitly loopback release host. */
export function runInstaller(sandbox: Sandbox, opts: InstallerRun): Promise<ScriptResult> {
  loopbackOnly(opts.releaseBaseUrl);
  return runSh(INSTALL_SH, {
    args: opts.args,
    shell: opts.shell,
    env: {
      HOME: sandbox.home,
      TMPDIR: sandbox.tmp,
      STARLING_INSTALL_DIR: sandbox.installDir,
      STARLING_RELEASE_BASE_URL: opts.releaseBaseUrl,
      SHELL: '/bin/zsh',
      ...(opts.env ?? {}),
    },
  });
}

/** Run uninstall.sh against the same sandbox conventions. */
export function runUninstaller(
  sandbox: Sandbox,
  opts: { args?: string[]; env?: Record<string, string | undefined>; shell?: string } = {},
): Promise<ScriptResult> {
  return runSh(UNINSTALL_SH, {
    args: opts.args,
    shell: opts.shell,
    env: {
      HOME: sandbox.home,
      TMPDIR: sandbox.tmp,
      STARLING_INSTALL_DIR: sandbox.installDir,
      ...(opts.env ?? {}),
    },
  });
}

/**
 * A PATH containing only the named tools, so a test can remove exactly one capability
 * (`curl`, `sha256sum`, …) without hiding the rest of the system.
 */
export function toolchain(root: string, names: string[]): string {
  const dir = join(root, 'toolchain');
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const resolved = Bun.which(name);
    if (resolved) symlinkSync(resolved, join(dir, name));
  }
  return dir;
}

/** Tools both scripts need, minus whatever a test wants to withhold. */
export const BASE_TOOLS = [
  'uname',
  'mktemp',
  'tar',
  'gzip',
  'rm',
  'mv',
  'mkdir',
  'chmod',
  'cp',
  'grep',
  'rmdir',
  'curl',
];

/** The SHA-256 tool this machine has, if any (macOS ships shasum, Linux sha256sum). */
export function checksumTool(): string | null {
  return Bun.which('sha256sum') ? 'sha256sum' : Bun.which('shasum') ? 'shasum' : null;
}

/** Write a `wget` shim that forwards to curl, for the wget code path on machines without wget. */
export function wgetShim(root: string): string {
  const dir = join(root, 'wget-shim');
  mkdirSync(dir, { recursive: true });
  const curl = Bun.which('curl');
  if (!curl) throw new Error('the wget shim needs curl');
  const path = join(dir, 'wget');
  writeFileSync(path, `#!/bin/sh\nexec ${curl} -fsSL "$2"\n`);
  chmodSync(path, 0o755);
  return dir;
}
