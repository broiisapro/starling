#!/usr/bin/env bun
/**
 * smoke.ts — measure a local Ollama model on the one job Starling asks of it:
 * judge a small diff and return a JSON audit verdict.
 *
 *   bun tools/local-models/smoke.ts [--model TAG] [--host URL] [--out FILE]
 *                                   [--keep-alive 5m] [--max-tokens 2000] [--think on|off]
 *
 *   --think off  disables the model's reasoning pass. Auditing a diff does not always need
 *                chain-of-thought, and thinking dominates the latency of a verdict, so both
 *                settings are worth measuring (Epic 28). Note: only /api/chat honours it.
 *
 * What it does
 *   1. Cold call: POST a JSON-schema-constrained "audit verdict" request to
 *      /v1/chat/completions (the OpenAI-compatible surface @starling/llm talks to),
 *      streaming, so the first token can be timed. This call pays the model load.
 *   2. Warm call: the same request on /api/chat with `format: <schema>`, which reports exact
 *      eval_count / eval_duration — the honest tokens/s number, and a load-free TTFT.
 *   3. Validates that the response is JSON, matches the verdict shape, and that the verdict is
 *      *sane* for the seeded diff (it adds no test, so pass must be false).
 *   4. Samples the memory footprint before and after the model is resident — this is what
 *      decides how many opencode sessions can run next to the model on demo day.
 *   5. Writes tools/local-models/results/smoke-<hostname>-<model>[-nothink].json and prints a summary.
 *
 * The default model is $STARLING_LOCAL_MODEL, else the primary for this machine's profile in
 * candidates.json, so `bun tools/local-models/smoke.ts` needs no flags on either laptop.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Snapshot } from "./host";
import { hardware, shell, slug, snapshot } from "./host";
import {
  type CallOptions,
  type Verdict,
  callNative,
  callV1,
  isLoaded,
  now,
  ollamaVersion,
  round,
  validateVerdict,
} from "./ollama";

// ── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1] as string;
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  return fallback;
}

const HERE = dirname(new URL(import.meta.url).pathname);
const HOST = arg("host", process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
const KEEP_ALIVE = arg("keep-alive", "5m");
const MAX_TOKENS = Number(arg("max-tokens", "2000"));
const THINK = arg("think", "on") !== "off";

function defaultModel(): string {
  const fromEnv = process.env.STARLING_LOCAL_MODEL;
  if (fromEnv) return fromEnv;
  try {
    const candidates = JSON.parse(readFileSync(join(HERE, "candidates.json"), "utf8")) as {
      profiles: Record<string, { primary: string }>;
    };
    const ramGb = Math.round(Number(shell(["sysctl", "-n", "hw.memsize"]).trim()) / 1073741824);
    if (ramGb < 12) return "qwen3.5:4b";
    const profile = ramGb >= 24 ? "mbp" : "air";
    return candidates.profiles[profile]?.primary ?? "qwen3.8:27b-mlx";
  } catch {
    return "qwen3.8:27b-mlx";
  }
}

const MODEL = arg("model", defaultModel());
const OUT = arg(
  "out",
  join(HERE, "results", `smoke-${slug(hardware().hostname)}-${slug(MODEL)}${THINK ? "" : "-nothink"}.json`),
);

// ── the fake diff under audit ───────────────────────────────────────────
const DIFF = `diff --git a/src/format.ts b/src/format.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/format.ts
+++ b/src/format.ts
@@ -1,5 +1,7 @@
 export function formatDate(d: Date): string {
-  return d.toISOString();
+  const pad = (n: number): string => String(n).padStart(2, "0");
+  return \`\${d.getFullYear()}-\${pad(d.getMonth() + 1)}-\${pad(d.getDate())}\`;
 }
`;

const DEFINITION_OF_DONE = [
  "formatDate returns YYYY-MM-DD in local time (no timezone suffix, no time component)",
  "a unit test covers a single-digit month and a single-digit day",
  "no other exported API changes",
];

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean", description: "true only if every definition-of-done item is satisfied" },
    summary: { type: "string", description: "one or two sentences: what was checked and what is wrong" },
    fixInstructions: { type: "string", description: "exact, actionable steps for the coding agent; omit when pass is true" },
  },
  required: ["pass", "summary"],
  additionalProperties: false,
} as const;

const SYSTEM = [
  "You are Starling's auditor. You judge one coding agent's diff against a definition of done.",
  "Be strict and literal: if a definition-of-done item is not visible in the diff, it is not done.",
  "Reply with a single JSON object and nothing else.",
].join(" ");

const USER = [
  "GOAL: format dates for the UI without a time component.",
  "",
  "DEFINITION OF DONE:",
  ...DEFINITION_OF_DONE.map((d, i) => `${i + 1}. ${d}`),
  "",
  "DIFF:",
  "```diff",
  DIFF.trimEnd(),
  "```",
  "",
  "Return {pass, summary, fixInstructions}.",
].join("\n");

const CALL: CallOptions = {
  host: HOST,
  model: MODEL,
  system: SYSTEM,
  user: USER,
  schema: VERDICT_SCHEMA,
  temperature: 0,
  maxTokens: MAX_TOKENS,
  keepAlive: KEEP_ALIVE,
  think: THINK,
};

// ── run ─────────────────────────────────────────────────────────────────
const startedAt = new Date().toISOString();
console.log(`🐦 smoke: ${MODEL} @ ${HOST}`);
console.log(`   host ${hardware().hostname} · bun ${Bun.version}`);

const version = await ollamaVersion(HOST);
if (version === "unreachable") {
  console.error(`\n✘ Ollama is not answering at ${HOST}. Run tools/local-models/setup.sh first.`);
  process.exit(1);
}
const alreadyLoaded = await isLoaded(HOST, MODEL);
const before = snapshot(MODEL);
console.log(`   ollama ${version} · model ${alreadyLoaded ? "already resident" : "cold"}`);
console.log(`   before: wired ${before.wiredMb ?? "?"} MB, free ${before.freePercent ?? "?"}%`);

const t0 = now();
let cold = await callV1(CALL);
const coldTotalMs = now() - t0;
let transport: "v1-json_schema" | "api-chat-format" = "v1-json_schema";
let fallbackNote: string | undefined;

if (cold.error || cold.text.trim() === "") {
  fallbackNote = cold.error ?? "empty completion from /v1/chat/completions";
  console.log(`   ! v1 failed: ${fallbackNote.slice(0, 140)}`);
  console.log("   → falling back to /api/chat with format:<schema>");
  const native = await callNative(CALL);
  if (native.error) {
    console.error(`\n✘ both transports failed. /api/chat: ${native.error}`);
    process.exit(1);
  }
  transport = "api-chat-format";
  cold = { text: native.text, timing: native.timing, status: 200 };
}

// Warm pass on the native endpoint: exact tokens/s and a load-free TTFT.
const warm = transport === "v1-json_schema" ? await callNative(CALL) : { text: cold.text, timing: cold.timing, error: undefined };
const after: Snapshot = snapshot(MODEL);

const { parsed, checks } = validateVerdict(cold.text, { expectPass: false });
const allOk = checks.every((c) => c.ok);

// Findings worth carrying to the packages that will call this endpoint.
const notes: string[] = [];
if (
  !THINK &&
  cold.timing.completionTokens &&
  warm.timing.completionTokens &&
  cold.timing.completionTokens > warm.timing.completionTokens * 1.5
) {
  notes.push(
    `think:false looks ignored on /v1/chat/completions (cold ${cold.timing.completionTokens} tokens vs ` +
      `warm ${warm.timing.completionTokens} on /api/chat); disable reasoning via the native endpoint.`,
  );
}
if (transport === "v1-json_schema" && cold.timing.completionTokens === MAX_TOKENS) {
  notes.push(`cold completion hit max_tokens (${MAX_TOKENS}): the verdict was truncated.`);
}

const result = {
  kind: "starling.local-model.smoke",
  schemaVersion: 1,
  startedAt,
  finishedAt: new Date().toISOString(),
  ok: allOk,
  host: { ...hardware(), bun: Bun.version },
  ollama: { url: HOST, version },
  model: MODEL,
  transport,
  ...(fallbackNote ? { fallbackNote } : {}),
  request: {
    endpoint: transport === "v1-json_schema" ? "/v1/chat/completions" : "/api/chat",
    responseFormat: "json_schema",
    schema: VERDICT_SCHEMA,
    system: SYSTEM,
    user: USER,
    temperature: 0,
    maxTokens: MAX_TOKENS,
    keepAlive: KEEP_ALIVE,
    think: THINK,
  },
  timings: {
    modelAlreadyResident: alreadyLoaded,
    cold: {
      ttftMs: round(cold.timing.ttftMs),
      totalMs: round(coldTotalMs),
      completionTokens: cold.timing.completionTokens,
      tokensPerSec: cold.timing.tokensPerSec === null ? null : Number(cold.timing.tokensPerSec.toFixed(2)),
      tokensPerSecSource: cold.timing.tokensPerSecSource,
    },
    warm: {
      ttftMs: round(warm.timing.ttftMs),
      totalMs: round(warm.timing.totalMs),
      completionTokens: warm.timing.completionTokens,
      tokensPerSec: warm.timing.tokensPerSec === null ? null : Number(warm.timing.tokensPerSec.toFixed(2)),
      tokensPerSecSource: warm.timing.tokensPerSecSource,
      loadDurationMs: round(warm.timing.loadDurationMs),
    },
    ...(warm.error ? { warmError: warm.error } : {}),
  },
  memory: { before, after },
  checks,
  ...(notes.length ? { notes } : {}),
  verdict: parsed as Verdict | null,
  rawResponse: cold.text,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);

// ── report ──────────────────────────────────────────────────────────────
const c = result.timings.cold;
const w = result.timings.warm;
console.log("");
console.log(`   transport        ${transport}`);
console.log(`   cold  ttft       ${c.ttftMs ?? "n/a"} ms   total ${c.totalMs} ms   (pays the model load)`);
console.log(`   warm  ttft       ${w.ttftMs ?? "n/a"} ms   total ${w.totalMs} ms   load ${w.loadDurationMs ?? 0} ms`);
console.log(`   tokens/s         ${w.tokensPerSec ?? c.tokensPerSec ?? "n/a"} (${w.tokensPerSecSource ?? c.tokensPerSecSource ?? "n/a"})`);
console.log(`   tokens           ${w.completionTokens ?? c.completionTokens ?? "n/a"}`);
console.log(`   resident         ${after.residentSize ?? "?"} (ollama ps)`);
console.log(
  `   memory           wired ${before.wiredMb ?? "?"} → ${after.wiredMb ?? "?"} MB, ` +
    `free ${before.freePercent ?? "?"}% → ${after.freePercent ?? "?"}%, ollama RSS ${after.ollamaRssMb} MB`,
);
if (after.ollamaPs) for (const line of after.ollamaPs.split("\n")) console.log(`     ${line}`);
console.log("");
console.log(`   verdict          ${parsed ? JSON.stringify(parsed) : "(unparseable)"}`);
for (const chk of checks) console.log(`   ${chk.ok ? "✔" : "✘"} ${chk.name} — ${chk.detail}`);
if (notes.length) {
  console.log("");
  for (const n of notes) console.log(`   note: ${n}`);
}
console.log("");
console.log(`   wrote ${OUT}`);
console.log(allOk ? "\n✨ smoke passed: a valid, sane JSON verdict from a local model." : "\n✘ smoke failed: see the checks above.");
process.exit(allOk ? 0 : 1);
