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
import { createLLMFromEnv, type LLMClient } from '../../packages/llm/src/index.ts';
import type { MapRenderer } from '../../packages/planner/src/index.ts';
import {
  createPlanner,
  discoverOpencodeService,
  type OpencodeService,
  serviceFileCandidates,
} from '../../packages/planner/src/index.ts';
import { defaultConfig, type Planner, StarlingError } from '../lib/core';

export type { OpencodeService };
export { discoverOpencodeService, serviceFileCandidates };

export interface LivePlannerOptions {
  service?: OpencodeService;
  temperature?: number;
  maxTokens?: number;
  maxRepairs?: number;
  minTasks?: number;
  maxTasks?: number;
  mapRenderer?: MapRenderer;
}

export interface LivePlanner {
  planner: Planner;
  llm: LLMClient;
  service: OpencodeService | undefined;
}

/** Build a planner that talks to a real opencode server through the `opencode` profile. */
export function createLivePlanner(options: LivePlannerOptions = {}): LivePlanner {
  const service = options.service ?? discoverOpencodeService();
  const llm = createLLMFromEnv({
    config: {
      ...defaultConfig,
      opencode: { mode: 'attach', port: 4096, url: service?.url ?? null },
    },
    env: {
      ...process.env,
      STARLING_LLM_PROFILE: process.env.STARLING_LLM_PROFILE ?? 'opencode',
      ...(service?.password === undefined ? {} : { OPENCODE_SERVER_PASSWORD: service.password }),
    },
  });
  const planner = createPlanner({
    llm,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.maxRepairs === undefined ? {} : { maxRepairs: options.maxRepairs }),
    ...(options.minTasks === undefined ? {} : { minTasks: options.minTasks }),
    ...(options.maxTasks === undefined ? {} : { maxTasks: options.maxTasks }),
    ...(options.mapRenderer === undefined ? {} : { mapRenderer: options.mapRenderer }),
  });
  return { planner, llm, service };
}

/** Keep the old failure message useful for a caller that truly has no server configured. */
export function requireOpencodeService(env: NodeJS.ProcessEnv = process.env): OpencodeService {
  const service = discoverOpencodeService(env);
  if (service === undefined) {
    throw new StarlingError(
      'CONFIG_INVALID',
      'No opencode server found. Start one (`opencode serve`) or set STARLING_OPENCODE_URL.',
    );
  }
  return service;
}
