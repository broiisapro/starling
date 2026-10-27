#!/usr/bin/env bun
/**
 * smoke.ts — measure a local Ollama model on the one job Starling asks of it:
 * judge a small diff and return a JSON audit verdict.
 *
 *   bun tools/local-models/smoke.ts [--model qwen3.6:35b-a3b] [--host URL] [--out FILE]
 *                                   [--keep-alive 5m] [--max-tokens 2000] [--think on|off]
 *
 *   --think off  disables the model's reasoning pass (where the tag supports it). Auditing
 *                a diff does not always need chain-of-thought, and thinking dominates the
 *                latency of a verdict, so both settings are worth measuring (Epic 28).
 *
 * What it does
 *   1. Cold call: POST a JSON-schema-constrained "audit verdict" request to
 *      /v1/chat/completions (the OpenAI-compatible surface @starling/llm talks to),
 *      streaming, so the first token can be timed. This call pays the model load.
 *   2. Warm call: the same request on /api/chat with `format: <schema>` and stream:true,
 *      which reports exact eval_count / eval_duration — the honest tokens/s number.
 *   3. Validates that the response is JSON, matches the verdict shape, and that the
 *      verdict is *sane* for the seeded diff (it adds no test, so pass must be false).
 *   4. Samples the memory footprint (ollama ps + process RSS + wired pages) before and
 *      after the model is resident — this is what decides how many opencode sessions
 *      can run next to the model on demo day.
 *   5. Writes tools/local-models/results/smoke-<hostname>-<model>.json and prints a summary.
 *
 * No dependencies: plain fetch, node:os, node:fs. This is a measuring instrument,
 * not product code.
 */

import { hostname } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// ── args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1] as string;
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  return fallback;
}
const HOST = arg("host", process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
const KEEP_ALIVE = arg("keep-alive", "5m");
const MAX_TOKENS = Number(arg("max-tokens", "2000"));
const THINK = arg("think", "on") !== "off";
const HERE = dirname(new URL(import.meta.url).pathname);

function slug(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function shell(cmd: string[]): string {
  try {
    return Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" }).stdout.toString();
  } catch {
    return "";
  }
}

/**
 * Default model: $STARLING_LOCAL_MODEL, else the primary for this machine's profile in
 * candidates.json (the same rule setup.sh applies). Keeps `bun smoke.ts` working on both
 * laptops with no flags.
 */
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
  join(HERE, "results", `smoke-${slug(hostname())}-${slug(MODEL)}${THINK ? "" : "-nothink"}.json`),
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

// ── types ───────────────────────────────────────────────────────────────
type Verdict = { pass: boolean; summary: string; fixInstructions?: string };

type Timings = {
  ttftMs: number | null;
  totalMs: number;
  completionTokens: number | null;
  tokensPerSec: number | null;
  tokensPerSecSource: "usage" | "api-chat-eval" | null;
  loadDurationMs: number | null;
};

type Snapshot = {
  ollamaPs: string;
  residentSize: string | null;
  ollamaRssMb: number;
  wiredMb: number | null;
  freePercent: number | null;
};

const now = () => performance.now();
const round = (n: number | null): number | null => (n === null ? null : Math.round(n));

// ── environment probes ──────────────────────────────────────────────────
async function ollamaVersion(): Promise<string> {
  try {
    const r = await fetch(`${HOST}/api/version`, { signal: AbortSignal.timeout(3000) });
    return ((await r.json()) as { version?: string }).version ?? "unknown";
  } catch {
    return "unreachable";
  }
}

async function isLoaded(): Promise<boolean> {
  try {
    const r = await fetch(`${HOST}/api/ps`, { signal: AbortSignal.timeout(3000) });
    const j = (await r.json()) as { models?: { name?: string; model?: string }[] };
    return (j.models ?? []).some((m) => m.name === MODEL || m.model === MODEL);
  } catch {
    return false;
  }
}

function snapshot(): Snapshot {
  const ps = shell(["ollama", "ps"]).trim();
  const line = ps.split("\n").find((l) => l.startsWith(MODEL)) ?? "";
  // NAME  ID  SIZE  PROCESSOR  CONTEXT  RUNNER  UNTIL → SIZE is the third column.
  const residentSize = line ? (line.split(/\s{2,}/)[2] ?? null) : null;

  let ollamaRssMb = 0;
  for (const l of shell(["ps", "-axo", "rss,comm"]).split("\n")) {
    if (!/ollama|llama/i.test(l)) continue;
    const kb = Number.parseInt(l.trim().split(/\s+/)[0] ?? "0", 10);
    if (Number.isFinite(kb)) ollamaRssMb += Math.round(kb / 1024);
  }

  const vm = shell(["vm_stat"]);
  const pageSize = Number.parseInt(/page size of (\d+)/.exec(vm)?.[1] ?? "0", 10);
  const wiredPages = Number.parseInt(/Pages wired down:\s+(\d+)/.exec(vm)?.[1] ?? "0", 10);
  const wiredMb = pageSize && wiredPages ? Math.round((wiredPages * pageSize) / 1024 / 1024) : null;

  const mp = shell(["memory_pressure", "-Q"]);
  const free = /free percentage:\s+(\d+)/.exec(mp)?.[1];

  return { ollamaPs: ps, residentSize, ollamaRssMb, wiredMb, freePercent: free ? Number(free) : null };
}

// ── transports ──────────────────────────────────────────────────────────
/** Cold path: the OpenAI-compatible endpoint, streamed. This is what @starling/llm will call. */
async function callV1(): Promise<{ text: string; timing: Timings; status: number; error?: string }> {
  const t0 = now();
  const res = await fetch(`${HOST}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: USER },
      ],
      temperature: 0,
      max_tokens: MAX_TOKENS,
      stream: true,
      stream_options: { include_usage: true },
      keep_alive: KEEP_ALIVE,
      ...(THINK ? {} : { think: false }),
      response_format: {
        type: "json_schema",
        json_schema: { name: "audit_verdict", schema: VERDICT_SCHEMA, strict: true },
      },
    }),
  });

  const empty = (status: number, error?: string) => ({
    text: "",
    timing: { ttftMs: null, totalMs: now() - t0, completionTokens: null, tokensPerSec: null, tokensPerSecSource: null, loadDurationMs: null } as Timings,
    status,
    error,
  });

  if (!res.ok) return empty(res.status, `${res.status} ${res.statusText}: ${(await res.text()).slice(0, 400)}`);
  const reader = res.body?.getReader();
  if (!reader) return empty(res.status, "no response body");

  let ttftMs: number | null = null;
  let text = "";
  let completionTokens: number | null = null;
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        if (data && data !== "[DONE]") {
          try {
            const evt = JSON.parse(data) as {
              choices?: { delta?: { content?: string } }[];
              usage?: { completion_tokens?: number } | null;
            };
            const delta = evt.choices?.[0]?.delta?.content;
            if (delta) {
              if (ttftMs === null) ttftMs = now() - t0;
              text += delta;
            }
            if (evt.usage?.completion_tokens) completionTokens = evt.usage.completion_tokens;
          } catch {
            // A malformed chunk is not fatal; the JSON check at the end is the real test.
          }
        }
      }
      nl = buf.indexOf("\n");
    }
  }

  const totalMs = now() - t0;
  // tokens/s here includes the prompt phase and any reasoning emitted before the first
  // *visible* content token, so it is a lower bound. The warm /api/chat pass reports the
  // exact eval_duration and is the number to quote.
  return {
    text,
    timing: {
      ttftMs,
      totalMs,
      completionTokens,
      tokensPerSec: completionTokens ? (completionTokens / totalMs) * 1000 : null,
      tokensPerSecSource: completionTokens ? "usage" : null,
      loadDurationMs: null,
    },
    status: res.status,
  };
}

/** Warm path: native /api/chat with `format: <schema>`, streamed. Exact eval counters. */
async function callNative(): Promise<{
  text: string;
  timing: Timings;
  error?: string;
}> {
  const t0 = now();
  const res = await fetch(`${HOST}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: USER },
      ],
      format: VERDICT_SCHEMA,
      options: { temperature: 0, num_predict: MAX_TOKENS },
      stream: true,
      keep_alive: KEEP_ALIVE,
      ...(THINK ? {} : { think: false }),
    }),
  });
  if (!res.ok) {
    return {
      text: "",
      timing: { ttftMs: null, totalMs: now() - t0, completionTokens: null, tokensPerSec: null, tokensPerSecSource: null, loadDurationMs: null },
      error: `${res.status} ${(await res.text()).slice(0, 300)}`,
    };
  }
  const reader = res.body?.getReader();
  if (!reader) return { text: "", timing: { ttftMs: null, totalMs: now() - t0, completionTokens: null, tokensPerSec: null, tokensPerSecSource: null, loadDurationMs: null }, error: "no body" };

  let ttftMs: number | null = null;
  let text = "";
  let evalCount: number | null = null;
  let evalDurationNs: number | null = null;
  let loadDurationNs: number | null = null;
  const decoder = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        try {
          const evt = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
            eval_count?: number;
            eval_duration?: number;
            load_duration?: number;
          };
          if (evt.message?.content) {
            if (ttftMs === null) ttftMs = now() - t0;
            text += evt.message.content;
          }
          if (evt.done) {
            evalCount = evt.eval_count ?? null;
            evalDurationNs = evt.eval_duration ?? null;
            loadDurationNs = evt.load_duration ?? null;
          }
        } catch {
          // ignore partial lines
        }
      }
      nl = buf.indexOf("\n");
    }
  }

  const totalMs = now() - t0;
  const genMs = evalDurationNs ? evalDurationNs / 1e6 : null;
  return {
    text,
    timing: {
      ttftMs,
      totalMs,
      completionTokens: evalCount,
      tokensPerSec: evalCount && genMs ? (evalCount / genMs) * 1000 : null,
      tokensPerSecSource: evalCount && genMs ? "api-chat-eval" : null,
      loadDurationMs: loadDurationNs ? loadDurationNs / 1e6 : null,
    },
  };
}

// ── verdict validation ──────────────────────────────────────────────────
function validate(text: string): { parsed: Verdict | null; checks: { name: string; ok: boolean; detail: string }[] } {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  let parsed: Verdict | null = null;
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    const raw = JSON.parse(trimmed) as Record<string, unknown>;
    checks.push({ name: "json-parses", ok: true, detail: `${trimmed.length} bytes` });
    const passOk = typeof raw.pass === "boolean";
    const summaryOk = typeof raw.summary === "string" && (raw.summary as string).length > 0;
    const fixOk = raw.fixInstructions === undefined || typeof raw.fixInstructions === "string";
    checks.push({ name: "shape-pass-boolean", ok: passOk, detail: `pass=${JSON.stringify(raw.pass)}` });
    checks.push({ name: "shape-summary-string", ok: summaryOk, detail: summaryOk ? "non-empty" : "missing/empty" });
    checks.push({ name: "shape-fixInstructions-optional", ok: fixOk, detail: String(typeof raw.fixInstructions) });
    const extra = Object.keys(raw).filter((k) => !["pass", "summary", "fixInstructions"].includes(k));
    checks.push({ name: "no-extra-keys", ok: extra.length === 0, detail: extra.length ? extra.join(", ") : "none" });
    if (passOk && summaryOk) {
      parsed = {
        pass: raw.pass as boolean,
        summary: raw.summary as string,
        ...(typeof raw.fixInstructions === "string" ? { fixInstructions: raw.fixInstructions } : {}),
      };
    }
    // The seeded diff adds no test, so a strict auditor must not pass it.
    checks.push({
      name: "verdict-is-sane",
      ok: parsed !== null && parsed.pass === false,
      detail: parsed === null ? "unparseable" : `pass=${parsed.pass} (expected false: the diff adds no test)`,
    });
  } catch (e) {
    checks.push({ name: "json-parses", ok: false, detail: String(e).slice(0, 200) });
  }
  return { parsed, checks };
}

// ── run ─────────────────────────────────────────────────────────────────
const startedAt = new Date().toISOString();
console.log(`🐦 smoke: ${MODEL} @ ${HOST}`);
console.log(`   host ${hostname()} · bun ${Bun.version}`);

const version = await ollamaVersion();
if (version === "unreachable") {
  console.error(`\n✘ Ollama is not answering at ${HOST}. Run tools/local-models/setup.sh first.`);
  process.exit(1);
}
const alreadyLoaded = await isLoaded();
const before = snapshot();
console.log(`   ollama ${version} · model ${alreadyLoaded ? "already resident" : "cold"}`);
console.log(`   before: wired ${before.wiredMb ?? "?"} MB, free ${before.freePercent ?? "?"}%`);

const t0 = now();
let cold = await callV1();
let transport: "v1-json_schema" | "api-chat-format" = "v1-json_schema";
let fallbackNote: string | undefined;

if (cold.error || cold.text.trim() === "") {
  fallbackNote = cold.error ?? "empty completion from /v1/chat/completions";
  console.log(`   ! v1 failed: ${fallbackNote.slice(0, 140)}`);
  console.log("   → falling back to /api/chat with format:<schema>");
  const native = await callNative();
  if (native.error) {
    console.error(`\n✘ both transports failed. /api/chat: ${native.error}`);
    process.exit(1);
  }
  transport = "api-chat-format";
  cold = { text: native.text, timing: native.timing, status: 200 };
}

const coldTotalMs = now() - t0;

// Warm pass on the native endpoint: exact tokens/s and a load-free TTFT.
const warm = transport === "v1-json_schema" ? await callNative() : { text: cold.text, timing: cold.timing, error: undefined };
const after = snapshot();

const { parsed, checks } = validate(cold.text);
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
  host: {
    hostname: hostname(),
    platform: process.platform,
    arch: process.arch,
    bun: Bun.version,
    cpu: shell(["sysctl", "-n", "machdep.cpu.brand_string"]).trim(),
    ramGb: Math.round(Number(shell(["sysctl", "-n", "hw.memsize"]).trim()) / 1073741824),
  },
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
  verdict: parsed,
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
console.log(`   memory           wired ${before.wiredMb ?? "?"} → ${after.wiredMb ?? "?"} MB, free ${before.freePercent ?? "?"}% → ${after.freePercent ?? "?"}%, ollama RSS ${after.ollamaRssMb} MB`);
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
