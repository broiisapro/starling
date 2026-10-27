/**
 * In-process fake of the endpoints `OpencodeClient`/`createOpencodeRunner` actually use.
 *
 * Shapes come from `test/fixtures/openapi.json` (opencode 2.1.2). No model, no network, no
 * real opencode process: `Bun.serve({ port: 0 })` only (AGENTS.md §4 / L23).
 */
import type { OpencodeEventEnvelope } from '../src/opencode/types';

export interface FakePromptContext {
  sessionId: string;
  text: string;
  emit: (event: { type: string; data: Record<string, unknown> }) => void;
  /** Mark the session active/idle, exactly like the real `/api/session/active` map. */
  setActive: (active: boolean) => void;
  server: FakeOpencodeServer;
}

export type FakePromptHandler = (ctx: FakePromptContext) => void | Promise<void>;

/** What a fake answers on `POST /api/experimental/generate`. */
export interface FakeStatelessContext {
  prompt: string;
  model?: { providerID?: string; id?: string };
  directory?: string;
  headers: Record<string, string>;
}

/**
 * Return `undefined` to answer 404, exactly like a server built before the route existed.
 * `{ status }` answers that status with an error envelope; `{ text }` answers 200.
 */
export type FakeStatelessHandler = (
  ctx: FakeStatelessContext,
) => { status?: number; text?: string } | undefined;

export interface FakeServerOptions {
  password?: string;
  onPrompt?: FakePromptHandler;
  onGenerateStateless?: FakeStatelessHandler;
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeSession {
  id: string;
  title?: string;
  directory?: string;
  model?: { providerID?: string; id?: string };
}

export interface FakeOpencodeServer {
  url: string;
  password: string | undefined;
  sessions: Map<string, FakeSession>;
  prompts: Array<{ sessionId: string; text: string; directory?: string }>;
  interrupts: string[];
  active: Set<string>;
  requests: RecordedRequest[];
  authFailures: number;
  sseConnections: number;
  emit(event: {
    type: string;
    data: Record<string, unknown>;
    created?: number;
    location?: { directory?: string };
  }): void;
  /** Close every open SSE response, as a flaky network would. */
  dropSse(): void;
  setActive(sessionId: string, active: boolean): void;
  close(): void;
}

const encoder = new TextEncoder();
let eventCounter = 0;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function readBody(req: Request): Promise<unknown> {
  return req
    .text()
    .then((text) => (text === '' ? undefined : JSON.parse(text)))
    .catch(() => undefined);
}

function headerRecord(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function createFakeOpencodeServer(options: FakeServerOptions = {}): FakeOpencodeServer {
  const password = options.password;
  const sessions = new Map<string, FakeSession>();
  const prompts: Array<{ sessionId: string; text: string; directory?: string }> = [];
  const interrupts: string[] = [];
  const active = new Set<string>();
  const requests: RecordedRequest[] = [];
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let counter = 0;
  let sseConnections = 0;

  const server: FakeOpencodeServer = {
    url: '',
    password,
    sessions,
    prompts,
    interrupts,
    active,
    requests,
    authFailures: 0,
    sseConnections: 0,
    emit(event) {
      const envelope: OpencodeEventEnvelope & { created: number } = {
        id: `evt_fake_${++eventCounter}`,
        created: event.created ?? Date.now(),
        type: event.type,
        data: event.data,
      };
      if (event.location !== undefined) envelope.location = event.location;
      const frame = `data: ${JSON.stringify(envelope)}\n\n`;
      for (const controller of [...clients]) {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          clients.delete(controller);
        }
      }
    },
    dropSse() {
      for (const controller of [...clients]) {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
      clients.clear();
    },
    setActive(sessionId, value) {
      if (value) active.add(sessionId);
      else active.delete(sessionId);
    },
    close() {
      server.dropSse();
      bunServer.stop(true);
    },
  };

  const defaultPrompt: FakePromptHandler = ({ sessionId, emit, setActive, server: fake }) => {
    const messageID = `msg_${sessionId}`;
    const partID = `prt_${sessionId}`;
    emit({
      type: 'message.part.delta',
      data: { sessionID: sessionId, messageID, partID, field: 'text', delta: 'Hello from the fake.' },
    });
    emit({
      type: 'message.part.updated',
      data: {
        sessionID: sessionId,
        time: Date.now(),
        part: {
          id: partID,
          sessionID: sessionId,
          messageID,
          type: 'text',
          text: 'Hello from the fake.',
          time: { start: Date.now(), end: Date.now() },
        },
      },
    });
    emit({
      type: 'message.part.updated',
      data: {
        sessionID: sessionId,
        time: Date.now(),
        part: {
          id: `prt_tool_${sessionId}`,
          sessionID: sessionId,
          messageID,
          type: 'tool',
          callID: `call_${sessionId}`,
          tool: 'read',
          state: { status: 'completed', input: { path: 'README.md' }, output: 'ok', time: {} },
        },
      },
    });
    const directory = fake.sessions.get(sessionId)?.directory;
    emit({
      type: 'file.edited',
      data: { file: 'README.md' },
      ...(directory === undefined ? {} : { location: { directory } }),
    });
    emit({
      type: 'message.part.updated',
      data: {
        sessionID: sessionId,
        time: Date.now(),
        part: {
          id: `prt_step_${sessionId}`,
          sessionID: sessionId,
          messageID,
          type: 'step-finish',
          reason: 'stop',
          cost: 0.0012,
          tokens: { input: 120, output: 30, reasoning: 0, cache: { read: 5, write: 0 } },
        },
      },
    });
    setActive(false);
    emit({ type: 'session.idle', data: { sessionID: sessionId } });
  };

  function authorized(req: Request): boolean {
    if (password === undefined) return true;
    const expected = `Basic ${btoa(`opencode:${password}`)}`;
    return req.headers.get('authorization') === expected;
  }

  const bunServer = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const headers = headerRecord(req);
      const body = await readBody(req);
      requests.push({ method: req.method, path: url.pathname, headers, body });

      if (!authorized(req)) {
        server.authFailures += 1;
        return json({ _tag: 'UnauthorizedError', message: 'Authentication required' }, 401);
      }

      if (url.pathname === '/api/info' && req.method === 'GET') {
        return json({
          version: '2.1.2-fake',
          pid: process.pid,
          urls: [server.url],
          paths: { tmp: '/tmp' },
        });
      }

      if (url.pathname === '/api/session/active' && req.method === 'GET') {
        const data: Record<string, { type: 'running' }> = {};
        for (const id of active) data[id] = { type: 'running' };
        return json({ data });
      }

      if (url.pathname === '/api/experimental/generate' && req.method === 'POST') {
        const input = (body ?? {}) as {
          prompt?: string;
          model?: { providerID?: string; id?: string };
        };
        const answer = options.onGenerateStateless?.({
          prompt: input.prompt ?? '',
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(headers['x-opencode-directory'] === undefined
            ? {}
            : { directory: headers['x-opencode-directory'] }),
          headers,
        });
        if (answer === undefined) {
          return json({ _tag: 'NotFound', message: 'no fake route for POST /api/experimental/generate' }, 404);
        }
        const status = answer.status ?? 200;
        if (status !== 200) {
          return json({ _tag: 'GenerateError', message: 'the fake refused' }, status);
        }
        // A body with no `text` field at all is a different animal from `text: ''`.
        return json(answer.text === undefined ? { data: {} } : { data: { text: answer.text } });
      }

      if (url.pathname === '/api/session' && req.method === 'POST') {
        const input = (body ?? {}) as {
          title?: string;
          model?: { providerID?: string; id?: string };
          location?: { directory?: string };
        };
        const id = `ses_fake_${++counter}`;
        const session: FakeSession = {
          id,
          directory: input.location?.directory,
          model: input.model,
        };
        if (input.title !== undefined) session.title = input.title;
        sessions.set(id, session);
        server.emit({
          type: 'session.created',
          data: {
            sessionID: id,
            title: input.title,
            location: { directory: input.location?.directory },
          },
        });
        return json({ data: { id, title: input.title, location: input.location } });
      }

      const promptMatch = /^\/api\/session\/([^/]+)\/prompt$/.exec(url.pathname);
      if (promptMatch !== null && req.method === 'POST') {
        const sessionId = decodeURIComponent(promptMatch[1] ?? '');
        if (!sessions.has(sessionId)) {
          return json({ _tag: 'SessionNotFoundError', message: 'session not found' }, 404);
        }
        const text =
          typeof (body as { text?: unknown } | undefined)?.text === 'string'
            ? (body as { text: string }).text
            : '';
        prompts.push({ sessionId, text, directory: headers['x-opencode-directory'] });
        active.add(sessionId);
        const handler = options.onPrompt ?? defaultPrompt;
        setTimeout(() => {
          void handler({
            sessionId,
            text,
            emit: server.emit,
            setActive: (value) => server.setActive(sessionId, value),
            server,
          });
        }, 0);
        return json({ data: { sessionID: sessionId, text } });
      }

      const interruptMatch = /^\/api\/session\/([^/]+)\/interrupt$/.exec(url.pathname);
      if (interruptMatch !== null && req.method === 'POST') {
        const sessionId = decodeURIComponent(interruptMatch[1] ?? '');
        if (!sessions.has(sessionId)) {
          return json({ _tag: 'SessionNotFoundError', message: 'session not found' }, 404);
        }
        const wasActive = active.delete(sessionId);
        interrupts.push(sessionId);
        server.emit({ type: 'session.idle', data: { sessionID: sessionId } });
        return json({ interrupted: wasActive });
      }

      if (url.pathname === '/api/event' && req.method === 'GET') {
        sseConnections += 1;
        server.sseConnections = sseConnections;
        let self: ReadableStreamDefaultController<Uint8Array> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            self = controller;
            clients.add(controller);
            controller.enqueue(encoder.encode(': connected\n\n'));
          },
          cancel() {
            if (self !== undefined) clients.delete(self);
          },
        });
        return new Response(stream, {
          headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        });
      }

      return json({ _tag: 'NotFound', message: `no fake route for ${req.method} ${url.pathname}` }, 404);
    },
  });

  const port = bunServer.port;
  if (port === undefined) throw new Error('fake opencode server did not bind a port');
  server.url = `http://127.0.0.1:${port}`;
  return server;
}
