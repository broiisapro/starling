/**
 * fake-ollama.ts — an in-process Ollama that answers deterministically, for `--dry-run` and tests.
 *
 * It speaks the four surfaces the benchmark touches (`/api/version`, `/api/ps`, `/api/generate` for
 * unloading, and the two chat endpoints) over `Bun.serve({ port: 0 })`, so nothing here needs a
 * model, a network or a single `ollama` command (ARCHITECTURE L23).
 *
 * The "smart" model gets every case right and the "lazy" one passes everything; that pair is enough
 * to prove the scoring, the rails and the recommender, which is the whole point of the dry run.
 *
 * It identifies the case from the diff embedded in the prompt, so the benchmark never leaks the
 * expected verdict through the request it sends.
 */

import type { AuditCase } from './cases';
import { findCaseForPrompt } from './cases';

export type FakeBehavior = 'smart' | 'lazy' | 'garbage' | 'oom';

export interface FakeModelSpec {
  name: string;
  behavior: FakeBehavior;
  /** What `/api/ps` reports as resident. Fake, but on the right scale for the RAM budgets. */
  sizeGb: number;
}

export interface FakeRequest {
  path: string;
  body: Record<string, unknown>;
}

export interface FakeOllama {
  url: string;
  requests: FakeRequest[];
  /** Models currently "loaded". Unloading is observable, which is what the unload test asserts. */
  resident(): string[];
  stop(): void;
}

/** Map a model name from the CLI onto a scripted behaviour, so `--dry-run` needs no config file. */
export function behaviorForName(name: string): FakeBehavior {
  const lower = name.toLowerCase();
  if (lower.includes('lazy')) return 'lazy';
  if (lower.includes('garbage') || lower.includes('broken')) return 'garbage';
  if (lower.includes('oom')) return 'oom';
  return 'smart';
}

export function fakeModelSpec(name: string): FakeModelSpec {
  const behavior = behaviorForName(name);
  const sizeGb = behavior === 'lazy' ? 3 : 7.5;
  return { name, behavior, sizeGb };
}

/** The answer a scripted model gives for a case. */
export function fakeAnswer(spec: FakeModelSpec, auditCase: AuditCase): string {
  if (spec.behavior === 'garbage') return 'I think this looks fine to me.';
  if (spec.behavior === 'lazy') {
    return JSON.stringify({ pass: true, summary: 'Looks good: the diff is consistent and complete.' });
  }
  const terms = auditCase.expect.mustMention;
  const base = auditCase.expect.pass
    ? `All ${auditCase.definitionOfDone.length} definition-of-done items are visible in the diff.`
    : 'Not done: the diff does not satisfy every definition-of-done item.';
  const summary = terms.length ? `${base} Evidence: ${terms.join(', ')}.` : base;
  return JSON.stringify(
    auditCase.expect.pass
      ? { pass: true, summary }
      : { pass: false, summary, fixInstructions: `Address ${terms.join(', ') || 'the missed DoD items'}.` },
  );
}

const tokensOf = (text: string): number => Math.max(1, Math.round(text.length / 4));

export interface FakeOllamaOptions {
  cases: AuditCase[];
  models: FakeModelSpec[];
  /** Simulated time to first token, ms. Small by default so the dry run is instant. */
  ttftMs?: number;
  seedResident?: boolean;
}

export function startFakeOllama(opts: FakeOllamaOptions): FakeOllama {
  const requests: FakeRequest[] = [];
  const loaded = new Map<string, number>();
  const ttftMs = opts.ttftMs ?? 1;
  const specs = new Map(opts.models.map((m) => [m.name, m]));
  for (const spec of opts.models) {
    if (opts.seedResident) loaded.set(spec.name, spec.sizeGb);
  }

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const streaming = (chunks: string[]): Response => {
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          await Bun.sleep(ttftMs);
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  };

  const resolve = (body: Record<string, unknown>): FakeModelSpec | undefined =>
    specs.get(typeof body.model === 'string' ? (body.model as string) : '');

  const promptOf = (body: Record<string, unknown>): string => {
    const messages = Array.isArray(body.messages) ? (body.messages as { content?: string }[]) : [];
    return messages.map((m) => m.content ?? '').join('\n');
  };

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body: Record<string, unknown> =
        request.method === 'POST'
          ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
          : {};
      requests.push({ path: url.pathname, body });

      if (url.pathname === '/api/version') return json({ version: '0.0.0-fake' });

      if (url.pathname === '/api/ps') {
        return json({
          models: [...loaded.entries()].map(([name, sizeGb]) => ({
            name,
            model: name,
            size: Math.round(sizeGb * 1024 ** 3),
            size_vram: Math.round(sizeGb * 1024 ** 3),
          })),
        });
      }

      if (url.pathname === '/api/generate') {
        const spec = resolve(body);
        if (!spec) return json({ error: `model '${String(body.model)}' not found` }, 404);
        if (body.keep_alive === 0) loaded.delete(spec.name);
        else loaded.set(spec.name, spec.sizeGb);
        return json({ model: spec.name, done: true });
      }

      if (url.pathname === '/v1/chat/completions' || url.pathname === '/api/chat') {
        const spec = resolve(body);
        if (!spec) return json({ error: `model '${String(body.model)}' not found` }, 404);
        const auditCase = findCaseForPrompt(promptOf(body), opts.cases);
        if (!auditCase) return json({ error: 'no case in this prompt' }, 422);
        if (spec.behavior === 'oom') {
          return json({ error: 'model requires more system memory (out of memory)' }, 500);
        }

        loaded.set(spec.name, spec.sizeGb);
        const text = fakeAnswer(spec, auditCase);
        const tokens = tokensOf(text);
        const evalNs = tokens * 20_000_000;

        if (url.pathname === '/v1/chat/completions') {
          const pieces = text.match(/.{1,24}/gs) ?? [text];
          const events = pieces.map(
            (piece) => `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`,
          );
          events.push(
            `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { completion_tokens: tokens } })}\n\n`,
          );
          events.push('data: [DONE]\n\n');
          return streaming(events);
        }

        const pieces = text.match(/.{1,24}/gs) ?? [text];
        const lines = pieces.map(
          (piece) => `${JSON.stringify({ message: { content: piece }, done: false })}\n`,
        );
        lines.push(
          `${JSON.stringify({
            message: { content: '' },
            done: true,
            eval_count: tokens,
            eval_duration: evalNs,
            load_duration: 0,
          })}\n`,
        );
        return streaming(lines);
      }

      return json({ error: 'not found' }, 404);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    resident: () => [...loaded.keys()].sort(),
    stop: () => server.stop(true),
  };
}
