/**
 * The planner's default model wiring.
 *
 * `createPlanner` takes an `LLM` because that is what makes the package testable against
 * `@starling/core/testing`. Requiring it, though, meant every caller that is not the engine (the
 * eval harness, a script, a notebook) had to know how to build the router. `createPlanner()` with no
 * options now behaves exactly like the CLI and the server: `loadConfig()` plus
 * `STARLING_LLM_PROFILE` (ARCHITECTURE L25/L29).
 *
 * The import is dynamic on purpose. Unit tests and the pure helpers (`validatePlan`, `repairPlan`,
 * `renderRepoMap`) must never pull the `openai`/`@opencode-ai/sdk` dependency graph into the process,
 * and a caller that passes its own `LLM` never pays for it either.
 */
import type { LLM } from '@starling/core';

/** Build the router from the environment (`starling.config.yaml` + `STARLING_LLM_PROFILE`). */
export async function createDefaultLlm(): Promise<LLM> {
  const mod = await import('@starling/llm');
  return mod.createLLMFromEnv();
}
