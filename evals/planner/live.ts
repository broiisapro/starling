/**
 * Live wiring for the planner evals (Wave 2, ARCHITECTURE L29).
 *
 * `evals/run.ts planner --impl real` builds whatever `@starling/planner` gives it with no options,
 * which resolves `starling.config.yaml` + `STARLING_LLM_PROFILE` from the working directory. That is
 * the right production behaviour but a clumsy way to iterate on a prompt: this module finds the
 * user's already-running `opencode serve` (its url and password are in the CLI's `service.json`),
 * builds the same router explicitly, and hands the planner an `LLM`.
 *
 * Nothing here runs at import time and nothing here is reachable from a `*.test.ts`, so the unit
 * test suite stays offline (L23). Point `STARLING_OPENCODE_URL` at another server to override.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLLMFromEnv, type LLMClient } from '../../packages/llm/src/index.ts';
import { createPlanner } from '../../packages/planner/src/index.ts';
import { defaultConfig, type Planner, StarlingError } from '../lib/core';

export interface OpencodeService {
  url: string;
  password?: string;
}

/** Where the `opencode` CLI records the server it is talking to. */
export function serviceFileCandidates(home: string = homedir()): string[] {
  return [join(home, '.local/state/opencode/service.json'), join(home, '.config/opencode/service.json')];
}

/**
 * Resolve the opencode server to talk to:
 * 1. `STARLING_OPENCODE_URL` (and optional `OPENCODE_SERVER_PASSWORD`) for CI or a second server;
 * 2. the running CLI's `service.json`;
 * 3. the configured default `http://127.0.0.1:4096`.
 */
export function discoverOpencodeService(env: NodeJS.ProcessEnv = process.env): OpencodeService {
  const override = env.STARLING_OPENCODE_URL?.trim();
  if (override !== undefined && override !== '') {
    return {
      url: override,
      ...(env.OPENCODE_SERVER_PASSWORD === undefined ? {} : { password: env.OPENCODE_SERVER_PASSWORD }),
    };
  }
  for (const path of serviceFileCandidates()) {
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
        };
      }
    } catch {
      // A half-written service.json is not worth failing an eval over; try the next candidate.
    }
  }
  throw new StarlingError(
    'CONFIG_INVALID',
    'No opencode server found. Start one (`opencode serve`) or set STARLING_OPENCODE_URL.',
  );
}

export interface LivePlannerOptions {
  service?: OpencodeService;
  temperature?: number;
  maxTokens?: number;
  maxRepairs?: number;
  minTasks?: number;
  maxTasks?: number;
}

export interface LivePlanner {
  planner: Planner;
  llm: LLMClient;
  service: OpencodeService;
}

/** Build a planner that talks to a real opencode server through the `opencode` profile. */
export function createLivePlanner(options: LivePlannerOptions = {}): LivePlanner {
  const service = options.service ?? discoverOpencodeService();
  const llm = createLLMFromEnv({
    config: { ...defaultConfig, opencode: { mode: 'attach', port: 4096, url: service.url } },
    env: {
      ...process.env,
      STARLING_LLM_PROFILE: process.env.STARLING_LLM_PROFILE ?? 'opencode',
      ...(service.password === undefined ? {} : { OPENCODE_SERVER_PASSWORD: service.password }),
    },
  });
  const planner = createPlanner({
    llm,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.maxRepairs === undefined ? {} : { maxRepairs: options.maxRepairs }),
    ...(options.minTasks === undefined ? {} : { minTasks: options.minTasks }),
    ...(options.maxTasks === undefined ? {} : { maxTasks: options.maxTasks }),
  });
  return { planner, llm, service };
}
