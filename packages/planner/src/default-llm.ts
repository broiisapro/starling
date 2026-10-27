/**
 * The planner's default model wiring.
 *
 * `createPlanner` takes an `LLM` because that is what makes the package testable against
 * `@starling/core/testing`. Requiring it, though, meant every caller that is not the engine (the
 * eval harness, a script, a notebook) had to know how to build the router. `createPlanner()` with no
 * options now behaves exactly like the CLI and the server: `loadConfig()` plus
 * `STARLING_LLM_PROFILE` (ARCHITECTURE L25/L29).
 *
 * The `opencode` profile is the one Wave 2 runs use (no DeepSeek API key, no Ollama). Its server URL
 * and Basic-auth password live in the running opencode CLI's `service.json`, not in
 * `starling.config.yaml`, so this module discovers them the same way the CLI's own clients do. An
 * explicit `STARLING_OPENCODE_URL` / `OPENCODE_SERVER_PASSWORD` always wins, which is what CI and a
 * second server need.
 *
 * The import is dynamic on purpose. Unit tests and the pure helpers (`validatePlan`, `repairPlan`,
 * `renderRepoMap`) must never pull the `openai`/`@opencode-ai/sdk` dependency graph into the process,
 * and a caller that passes its own `LLM` never pays for it either.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type LLM, loadConfig } from '@starling/core';

export interface OpencodeService {
  url: string;
  password?: string;
}

/** Where the `opencode` CLI records the server it is talking to (state first, then config). */
export function serviceFileCandidates(home: string = homedir()): string[] {
  return [join(home, '.local/state/opencode/service.json'), join(home, '.config/opencode/service.json')];
}

/**
 * Resolve the local opencode server, if this machine has one:
 * 1. `STARLING_OPENCODE_URL` (plus optional `OPENCODE_SERVER_PASSWORD`) for CI or a second server;
 * 2. the running CLI's `service.json`;
 * 3. `undefined`, so the caller can fall back to `starling.config.yaml` / the default port.
 */
export function discoverOpencodeService(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): OpencodeService | undefined {
  const override = env.STARLING_OPENCODE_URL?.trim();
  const password = env.OPENCODE_SERVER_PASSWORD;
  if (override !== undefined && override !== '') {
    return { url: override, ...(password === undefined || password === '' ? {} : { password }) };
  }
  for (const path of serviceFileCandidates(home)) {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as { url?: unknown; password?: unknown };
      if (typeof parsed.url === 'string' && parsed.url !== '') {
        return {
          url: parsed.url,
          ...(typeof parsed.password === 'string' ? { password: parsed.password } : {}),
          ...(password === undefined || password === '' ? {} : { password }),
        };
      }
    } catch {
      // A half-written service.json is not worth failing a plan over; try the next candidate.
    }
  }
  return undefined;
}

/** Build the router from the environment (`starling.config.yaml` + `STARLING_LLM_PROFILE`). */
export async function createDefaultLlm(env: NodeJS.ProcessEnv = process.env): Promise<LLM> {
  const mod = await import('@starling/llm');
  const profile = mod.parseProfile(env.STARLING_LLM_PROFILE);
  if (profile !== 'opencode') return mod.createLLMFromEnv({ env });

  const config = loadConfig(undefined, process.cwd());
  const service = discoverOpencodeService(env);
  if (service === undefined) return mod.createLLMFromEnv({ config, env });

  return mod.createLLMFromEnv({
    config: {
      ...config,
      opencode: { ...config.opencode, url: config.opencode.url ?? service.url },
    },
    env: {
      ...env,
      ...(env.OPENCODE_SERVER_PASSWORD === undefined && service.password !== undefined
        ? { OPENCODE_SERVER_PASSWORD: service.password }
        : {}),
    },
  });
}
