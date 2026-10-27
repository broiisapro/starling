/**
 * Local types for the installed opencode server (v2.1.2, `opencode serve`).
 *
 * Why hand-written: `@opencode-ai/sdk@1.19.4` ships a v1 client and a `v2` entry point whose
 * generated types describe a *different* v2 surface (`properties` payloads, `session.next.*`
 * events, `session.prompt` with `parts`). The server we recorded (see
 * `test/fixtures/openapi.json`) answers on `/api/*`, uses `data` payloads and the
 * `SessionV1` event family. See `docs/epic-15-runner.md` for the full comparison.
 */

/** The SSE envelope `GET /api/event` sends on opencode 2.1.2. */
export interface OpencodeEventEnvelope {
  id?: string;
  /** Epoch ms set by the server. */
  created?: number;
  type: string;
  data?: Record<string, unknown>;
  location?: { directory?: string };
  durable?: Record<string, unknown>;
}

/** `Session.Info` — only the fields Starling reads. */
export interface OpencodeSessionInfo {
  id: string;
  projectID?: string;
  title?: string;
  model?: { providerID?: string; id?: string; variant?: string };
  location?: { directory?: string };
  tokens?: OpencodeTokenUsage;
  cost?: number;
  outcome?: 'succeeded' | 'failed' | 'interrupted';
  time?: { created?: number; updated?: number; idle?: number };
}

export interface OpencodeTokenUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

/** One entry of `GET /api/session/active`. */
export interface OpencodeActiveSession {
  type: 'running';
}

/** `ServerInfo` from `GET /api/info`. */
export interface OpencodeServerInfo {
  version: string;
  pid: number;
  urls: string[];
  paths: { tmp: string };
}

/** Body accepted by `POST /api/session`. */
export interface OpencodeCreateSessionBody {
  id?: string | null;
  parentID?: string | null;
  title?: string | null;
  agent?: string | null;
  model?: { providerID: string; id: string; variant?: string } | null;
  location?: { directory: string } | null;
}

/** Response wrapper the v2 API uses for most JSON routes. */
export interface OpencodeDataResponse<T> {
  data: T;
}
