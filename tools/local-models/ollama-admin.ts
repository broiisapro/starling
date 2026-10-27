/**
 * ollama-admin.ts — the management half of Ollama that the benchmark needs: what is resident, how
 * big it is, and how to unload it.
 *
 * This is `ollama ps` and `keep_alive: 0` over HTTP instead of the CLI, for one reason: tests and
 * `--dry-run` talk to an in-process `Bun.serve` fake, and the brief forbids running `ollama`
 * commands on a machine that is already busy building Starling (ARCHITECTURE L23).
 */

export interface ResidentEntry {
  name: string;
  /** Weights + KV cache as Ollama reports it, bytes. `null` when the field is missing. */
  sizeBytes: number | null;
  /** The GPU/wired part of `size`, bytes. */
  sizeVramBytes: number | null;
}

interface PsResponse {
  models?: { name?: string; model?: string; size?: number; size_vram?: number }[];
}

/** GET /api/ps → the models currently loaded, as `ollama ps` would print them. */
export async function listResident(host: string): Promise<ResidentEntry[]> {
  try {
    const res = await fetch(`${host}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const json = (await res.json()) as PsResponse;
    return (json.models ?? []).map((m) => ({
      name: m.name ?? m.model ?? '',
      sizeBytes: typeof m.size === 'number' ? m.size : null,
      sizeVramBytes: typeof m.size_vram === 'number' ? m.size_vram : null,
    }));
  } catch {
    // A missing server is reported once, by ollamaVersion(). Here it just means "nothing resident".
    return [];
  }
}

/** Ollama omits `:latest` from some responses, so match loosely but never by substring of a tag. */
export function sameModel(a: string, b: string): boolean {
  const norm = (s: string): string => (s.includes(':') ? s : `${s}:latest`);
  return norm(a) === norm(b);
}

/** Resident size of one model in GB, or null when it is not loaded. */
export function residentGb(entries: ResidentEntry[], model: string): number | null {
  const hit = entries.find((e) => sameModel(e.name, model));
  if (!hit || hit.sizeBytes === null) return null;
  return Number((hit.sizeBytes / 1024 ** 3).toFixed(2));
}

/**
 * Unload a model by asking Ollama to keep it for zero seconds. Resolves to whether the server
 * accepted the request; a 404 for an unknown model is not an error worth aborting a run over.
 */
export async function unloadModel(host: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ model, keep_alive: 0 }),
    });
    if (!res.ok) return false;
    await res.text();
    return true;
  } catch {
    return false;
  }
}
