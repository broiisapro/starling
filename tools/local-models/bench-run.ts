/**
 * bench-run.ts — the measurement loop: every case, every model, in the order the rails allow.
 *
 * All I/O is injected (`BenchProbes`, the two call functions) so the whole loop can run against an
 * in-process fake in tests and in `--dry-run`, and against the real daemon on the laptop.
 *
 * Order matters and is deliberate:
 *   1. sample memory and residency *before* the model loads;
 *   2. ask every case (and every repeat) through the same request the smoke test sends;
 *   3. abort the model on the first OOM-ish answer instead of grinding the machine into swap;
 *   4. sample the resident size while it is warm, then unload it before the next model loads.
 */

import {
  type AttemptRecord,
  isMemoryFailure,
  isUnreachable,
  judgeAnswer,
  type ModelBenchResult,
  summariseModel,
} from './bench-core';
import type { AuditCase } from './cases';
import { caseRequest } from './cases';
import { type CallOptions, type CallResult, callNative, callV1 } from './ollama';
import { residentGb, unloadModel } from './ollama-admin';
import type { BenchProbes } from './probes';

/** One HTTP attempt. Injected in tests so the loop never needs a server. */
export type CallFn = (o: CallOptions) => Promise<CallResult>;

export interface BenchDeps {
  probes: BenchProbes;
  /** Epoch-ms clock. Injected so result timestamps are testable. */
  now(): number;
}

export interface RunBenchOptions {
  host: string;
  profile: string;
  models: string[];
  cases: AuditCase[];
  repeat: number;
  maxTokens: number;
  keepAlive: string;
  think: boolean;
  log?(msg: string): void;
  /** Overridden by tests; defaults are the shared client in ollama.ts. */
  callV1?: CallFn;
  callNative?: CallFn;
}

const RAW_LIMIT = 4000;

const short = (s: string | undefined, n = 140): string => {
  const text = s ?? 'no error reported';
  return text.length > n ? `${text.slice(0, n)}…` : text;
};

/** One model: load (implicitly, by calling it), ask every case, measure, unload. */
async function benchOneModel(
  model: string,
  opts: RunBenchOptions,
  deps: BenchDeps,
  v1: CallFn,
  native: CallFn,
): Promise<ModelBenchResult> {
  const log = opts.log ?? (() => {});
  const startedAt = deps.now();
  const before = await deps.probes.listResident(opts.host);
  const alreadyResident = residentGb(before, model) !== null;
  const freeRamBeforeGb = await deps.probes.freeRamGb();

  log(
    `   ${model}: ${alreadyResident ? 'already resident' : 'cold'} · free RAM ${freeRamBeforeGb ?? '?'} GB · ` +
      `${opts.cases.length} cases × ${opts.repeat}`,
  );

  const attempts: AttemptRecord[] = [];
  let abortReason: string | undefined;
  let peakResidentGb: number | null = null;

  for (let repeat = 0; repeat < opts.repeat && abortReason === undefined; repeat += 1) {
    for (const auditCase of opts.cases) {
      const request = caseRequest(auditCase);
      const call: CallOptions = {
        host: opts.host,
        model,
        system: request.system,
        user: request.user,
        schema: request.schema,
        temperature: 0,
        maxTokens: opts.maxTokens,
        keepAlive: opts.keepAlive,
        think: opts.think,
      };

      let result: CallResult = await v1(call);
      let transport: AttemptRecord['transport'] = result.error || result.text.trim() === '' ? 'none' : 'v1';

      // Same fallback as smoke.ts: one native attempt when the compatible endpoint lets us down.
      if (transport === 'none') {
        const fallback = await native(call);
        if (!fallback.error && fallback.text.trim() !== '') {
          result = fallback;
          transport = 'native';
        }
      }

      if (isUnreachable(result) && attempts.length === 0) {
        abortReason = `Ollama is not answering at ${opts.host}: ${short(result.error)}`;
        break;
      }

      const judgement = judgeAnswer(result.text, auditCase.expect);
      attempts.push({
        caseKey: auditCase.key,
        repeat,
        transport,
        expectedPass: auditCase.expect.pass,
        ttftMs: result.timing.ttftMs === null ? null : Math.round(result.timing.ttftMs),
        latencyMs: Math.round(result.timing.totalMs),
        completionTokens: result.timing.completionTokens,
        tokensPerSec:
          result.timing.tokensPerSec === null ? null : Number(result.timing.tokensPerSec.toFixed(2)),
        judgement,
        ...(result.error ? { error: short(result.error) } : {}),
        rawResponse: result.text.slice(0, RAW_LIMIT),
      });

      if (isMemoryFailure(result)) {
        abortReason = `out of memory on ${auditCase.key}: ${short(result.error, 200)}`;
        log(`   ✘ ${model}: ${abortReason} — aborting this model.`);
        break;
      }

      // Sample once the model is warm; the last case re-samples in case it grew a KV cache.
      if (peakResidentGb === null) {
        peakResidentGb = residentGb(await deps.probes.listResident(opts.host), model);
      }
    }
  }

  const freeRamAfterGb = await deps.probes.freeRamGb();
  peakResidentGb = residentGb(await deps.probes.listResident(opts.host), model) ?? peakResidentGb;
  const unloaded = await unloadModel(opts.host, model);

  const finishedAt = deps.now();
  return summariseModel({
    model,
    profile: opts.profile,
    startedAt,
    finishedAt,
    attempts,
    caseKeys: opts.cases.map((c) => c.key),
    ...(abortReason ? { abortReason } : {}),
    residentGb: peakResidentGb,
    freeRamBeforeGb,
    freeRamAfterGb,
    alreadyResident,
    unloaded,
  });
}

/** Run the matrix. Models are benchmarked one at a time, each unloaded before the next loads. */
export async function runBench(opts: RunBenchOptions, deps: BenchDeps): Promise<ModelBenchResult[]> {
  const v1 = opts.callV1 ?? callV1;
  const native = opts.callNative ?? callNative;
  const results: ModelBenchResult[] = [];
  for (const model of opts.models) {
    results.push(await benchOneModel(model, opts, deps, v1, native));
  }
  return results;
}
