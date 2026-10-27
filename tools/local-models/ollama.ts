/**
 * ollama.ts — a tiny, dependency-free client for the two Ollama surfaces Starling uses.
 *
 * Exists so the smoke test (and Epic 28's benchmark matrix) can share one honest
 * implementation of the OpenAI-compatible call and the native call with exact eval counters.
 * Machine/memory probing lives in host.ts. Not product code — @starling/llm owns the router.
 */

export type Verdict = { pass: boolean; summary: string; fixInstructions?: string };

export type Timings = {
  ttftMs: number | null;
  totalMs: number;
  completionTokens: number | null;
  tokensPerSec: number | null;
  tokensPerSecSource: "usage" | "api-chat-eval" | null;
  loadDurationMs: number | null;
};

export type CallOptions = {
  host: string;
  model: string;
  system: string;
  user: string;
  schema: object;
  temperature?: number;
  maxTokens?: number;
  keepAlive?: string;
  think?: boolean;
};

export type CallResult = { text: string; timing: Timings; status: number; error?: string };

export type Check = { name: string; ok: boolean; detail: string };

/** Generous: a cold 27B load plus a thinking pass can take a minute. */
const REQUEST_TIMEOUT_MS = 600_000;

export const now = (): number => performance.now();
export const round = (n: number | null): number | null => (n === null ? null : Math.round(n));

const describe = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

const emptyTiming = (totalMs: number): Timings => ({
  ttftMs: null,
  totalMs,
  completionTokens: null,
  tokensPerSec: null,
  tokensPerSecSource: null,
  loadDurationMs: null,
});

export async function ollamaVersion(host: string): Promise<string> {
  try {
    const r = await fetch(`${host}/api/version`, { signal: AbortSignal.timeout(3000) });
    return ((await r.json()) as { version?: string }).version ?? "unknown";
  } catch {
    return "unreachable";
  }
}

export async function isLoaded(host: string, model: string): Promise<boolean> {
  try {
    const r = await fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(3000) });
    const j = (await r.json()) as { models?: { name?: string; model?: string }[] };
    return (j.models ?? []).some((m) => m.name === model || m.model === model);
  } catch {
    return false;
  }
}

/**
 * Read a streamed body line by line and hand each non-empty line to `handle`.
 * Returns an error string instead of throwing: a dropped stream keeps the partial answer,
 * and the caller's JSON check is what decides whether that partial answer is usable.
 */
async function readLines(res: Response, handle: (line: string) => void): Promise<string | undefined> {
  const reader = res.body?.getReader();
  if (!reader) return "no response body";
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) handle(line);
        nl = buf.indexOf("\n");
      }
    }
  } catch (e) {
    return describe(e);
  }
  return undefined;
}

/** Cold path: the OpenAI-compatible endpoint, streamed. This is what @starling/llm will call. */
export async function callV1(o: CallOptions): Promise<CallResult> {
  const t0 = now();
  let res: Response;
  try {
    res = await fetch(`${o.host}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: o.model,
        messages: [
          { role: "system", content: o.system },
          { role: "user", content: o.user },
        ],
        temperature: o.temperature ?? 0,
        max_tokens: o.maxTokens ?? 2000,
        stream: true,
        stream_options: { include_usage: true },
        keep_alive: o.keepAlive ?? "5m",
        ...(o.think === false ? { think: false } : {}),
        response_format: {
          type: "json_schema",
          json_schema: { name: "audit_verdict", schema: o.schema, strict: true },
        },
      }),
    });
  } catch (e) {
    return { text: "", timing: emptyTiming(now() - t0), status: 0, error: `request failed: ${describe(e)}` };
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 400);
    return { text: "", timing: emptyTiming(now() - t0), status: res.status, error: `${res.status} ${res.statusText}: ${body}` };
  }

  let ttftMs: number | null = null;
  let text = "";
  let completionTokens: number | null = null;
  const streamError = await readLines(res, (line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
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
  });

  const totalMs = now() - t0;
  // tokens/s here includes the prompt phase and any reasoning emitted before the first
  // *visible* content token, so it is a lower bound. callNative reports the exact number.
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
    ...(streamError ? { error: `stream ended early: ${streamError}` } : {}),
  };
}

/** Warm path: native /api/chat with `format: <schema>`, streamed. Exact eval counters. */
export async function callNative(o: CallOptions): Promise<CallResult> {
  const t0 = now();
  let res: Response;
  try {
    res = await fetch(`${o.host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: o.model,
        messages: [
          { role: "system", content: o.system },
          { role: "user", content: o.user },
        ],
        format: o.schema,
        options: { temperature: o.temperature ?? 0, num_predict: o.maxTokens ?? 2000 },
        stream: true,
        keep_alive: o.keepAlive ?? "5m",
        ...(o.think === false ? { think: false } : {}),
      }),
    });
  } catch (e) {
    return { text: "", timing: emptyTiming(now() - t0), status: 0, error: `request failed: ${describe(e)}` };
  }
  if (!res.ok) {
    return { text: "", timing: emptyTiming(now() - t0), status: res.status, error: `${res.status} ${(await res.text()).slice(0, 300)}` };
  }

  let ttftMs: number | null = null;
  let text = "";
  let evalCount: number | null = null;
  let evalDurationNs: number | null = null;
  let loadDurationNs: number | null = null;
  const streamError = await readLines(res, (line) => {
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
      // ignore a partial line
    }
  });

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
    status: res.status,
    ...(streamError ? { error: `stream ended early: ${streamError}` } : {}),
  };
}

/**
 * Parse and judge the model's answer. `expectPass: false` asserts the verdict is *sane*
 * for a diff that is missing a definition-of-done item.
 */
export function validateVerdict(
  text: string,
  opts: { expectPass: boolean } = { expectPass: false },
): { parsed: Verdict | null; checks: Check[] } {
  const checks: Check[] = [];
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
    checks.push({
      name: "verdict-is-sane",
      ok: parsed !== null && parsed.pass === opts.expectPass,
      detail:
        parsed === null
          ? "unparseable"
          : `pass=${parsed.pass} (expected ${opts.expectPass}${opts.expectPass ? "" : ": the diff adds no test"})`,
    });
  } catch (e) {
    checks.push({ name: "json-parses", ok: false, detail: String(e).slice(0, 200) });
  }
  return { parsed, checks };
}
