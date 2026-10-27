/**
 * `AgentRunner` on top of one opencode server (v2.1.2).
 *
 * One server, many sessions. Each `start()` creates a session scoped to the task's worktree
 * (`location.directory` + `x-opencode-directory`), admits the worker prompt, and returns the
 * session id. A single SSE subscription (`GET /api/event`) is demultiplexed by session id into
 * Starling `AgentEvent`s.
 */

import type { AgentEvent, AgentEventKind, AgentRunner, Clock, EventBus, ModelRef } from '@starling/core';
import { StarlingError, systemClock, toStarlingError } from '@starling/core';
import { sleep } from '../schedule';
import { Semaphore } from '../semaphore';
import { readSse } from '../sse';
import { OpencodeClient } from './client';
import { EventNormalizer } from './normalize';
import { type SpawnedServer, spawnOpencodeServer } from './spawn';

export interface OpencodeRunnerOptions {
  /** `spawn` starts a private `opencode serve`; `attach` uses an existing server. */
  mode: 'spawn' | 'attach';
  /** Required for attach mode. Ignored (but tolerated) in spawn mode. */
  url?: string;
  /** Port for spawn mode. A free port is chosen when omitted. */
  port?: number;
  /** Server password. Defaults to `OPENCODE_SERVER_PASSWORD`, then a random one in spawn mode. */
  password?: string;
  /**
   * Accepted for API compatibility. On opencode 2.1.2 `serve` already runs a private server —
   * `--standalone` is a root CLI flag, not a `serve` flag (the server rejects it) — so this is
   * a no-op. Recorded in `test/fixtures/opencode-cli.txt`.
   */
  standalone?: boolean;
  bus?: EventBus;
  clock?: Clock;
  spawn?: typeof Bun.spawn;
  fetch?: typeof fetch;
  /** Maximum agent turns admitted at once across all sessions. Default 8. */
  maxConcurrentPrompts?: number;
  /** Minimum spacing between `text` events per session. Default 500 ms. */
  textDebounceMs?: number;
  /** Executable name/path for spawn mode. Default `opencode`. */
  command?: string;
  startupTimeoutMs?: number;
  healthPollMs?: number;
  /** How long `start()` waits for the SSE stream to open. Default 5 s. */
  streamReadyTimeoutMs?: number;
  reconnect?: { minMs?: number; maxMs?: number; factor?: number };
}

export interface OpencodeRunner extends AgentRunner {
  url(): string;
  health(): Promise<boolean>;
}

interface SessionMeta {
  runId: string;
  taskKey: string;
  directory: string;
}

interface ReconnectConfig {
  minMs: number;
  maxMs: number;
  factor: number;
}

const DEFAULT_RECONNECT: ReconnectConfig = { minMs: 100, maxMs: 2_000, factor: 2 };

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function findFreePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) {
    throw new StarlingError('RUNNER_ERROR', 'could not reserve a free port for opencode serve');
  }
  return port;
}

class OpencodeRunnerImpl implements OpencodeRunner {
  readonly #clock: Clock;
  readonly #bus: EventBus | undefined;
  readonly #fetch: typeof fetch;
  readonly #spawnFn: typeof Bun.spawn;
  readonly #command: string | undefined;
  readonly #password: string | undefined;
  readonly #reconnect: ReconnectConfig;
  readonly #startupTimeoutMs: number;
  readonly #healthPollMs: number;
  readonly #streamReadyTimeoutMs: number;
  readonly #slots: Semaphore;
  readonly #normalizer: EventNormalizer;
  readonly #sessions = new Map<string, SessionMeta>();
  readonly #listeners = new Set<(event: AgentEvent) => void>();
  readonly #held = new Map<string, Promise<(() => void) | undefined>>();

  #client: OpencodeClient;
  #baseUrl: string;
  #spawned: SpawnedServer | undefined;
  #exitHandler: (() => void) | undefined;
  #ready: Promise<void>;
  #startupError: StarlingError | undefined;
  #closed = false;
  #streamReady: Promise<void> | undefined;
  #streamOpen: (() => void) | undefined;
  #streamReadyTimer: ReturnType<typeof setTimeout> | undefined;
  #streamAbort: AbortController | undefined;

  constructor(options: OpencodeRunnerOptions) {
    this.#clock = options.clock ?? systemClock;
    this.#bus = options.bus;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#spawnFn = options.spawn ?? Bun.spawn;
    this.#command = options.command;
    this.#reconnect = {
      minMs: options.reconnect?.minMs ?? DEFAULT_RECONNECT.minMs,
      maxMs: options.reconnect?.maxMs ?? DEFAULT_RECONNECT.maxMs,
      factor: options.reconnect?.factor ?? DEFAULT_RECONNECT.factor,
    };
    this.#startupTimeoutMs = options.startupTimeoutMs ?? 20_000;
    this.#healthPollMs = options.healthPollMs ?? 100;
    this.#streamReadyTimeoutMs = options.streamReadyTimeoutMs ?? 5_000;
    this.#slots = new Semaphore(options.maxConcurrentPrompts ?? 8);
    this.#normalizer = new EventNormalizer({
      textDebounceMs: options.textDebounceMs ?? 500,
      emit: (sessionId, kind, data) => this.#emit(sessionId, kind, data),
    });

    if (options.mode === 'attach') {
      if (options.url === undefined || options.url === '') {
        throw new StarlingError('INVALID_ARGUMENT', 'attach mode requires an opencode server url');
      }
      this.#baseUrl = options.url.replace(/\/+$/, '');
      this.#password = options.password ?? process.env.OPENCODE_SERVER_PASSWORD;
      this.#client = this.#makeClient();
      this.#ready = Promise.resolve();
      return;
    }

    const port = options.port ?? findFreePort();
    this.#baseUrl = `http://127.0.0.1:${port}`;
    this.#password = options.password ?? process.env.OPENCODE_SERVER_PASSWORD ?? crypto.randomUUID();
    this.#client = this.#makeClient();
    this.#spawned = spawnOpencodeServer({
      command: this.#command,
      port,
      password: this.#password,
      spawn: this.#spawnFn,
      onLine: (line) => {
        if (line.includes('server listening on')) this.#log('info', `opencode ${line}`);
      },
    });
    this.#exitHandler = () => {
      try {
        this.#spawned?.process.kill('SIGKILL');
      } catch {
        // The process is already gone; nothing to clean up.
      }
    };
    process.on('exit', this.#exitHandler);
    this.#ready = this.#startup();
  }

  url(): string {
    return this.#baseUrl;
  }

  async health(): Promise<boolean> {
    await this.#ready;
    if (this.#startupError !== undefined || this.#closed) return false;
    return this.#probe();
  }

  async start(opts: {
    runId: string;
    taskKey: string;
    dir: string;
    prompt: string;
    model: ModelRef;
    title: string;
  }): Promise<{ sessionId: string }> {
    await this.#ensureReady();

    let session: { id: string };
    try {
      session = await this.#client.createSession({
        directory: opts.dir,
        title: opts.title,
        model: opts.model,
      });
    } catch (err) {
      throw toStarlingError(err, 'RUNNER_ERROR', `could not create a session for ${opts.taskKey}`);
    }

    this.#sessions.set(session.id, {
      runId: opts.runId,
      taskKey: opts.taskKey,
      directory: opts.dir,
    });
    this.#normalizer.register(session.id, {
      title: opts.title,
      model: opts.model,
      directory: opts.dir,
    });
    await this.#ensureStream();
    this.#normalizer.markPromptSent(session.id);

    // The port says "send the prompt asynchronously and return sessionId": admission happens
    // in the background so a saturated semaphore never delays session creation.
    void this.#admit(session.id, opts.prompt, opts.dir);
    return { sessionId: session.id };
  }

  async send(sessionId: string, prompt: string): Promise<void> {
    await this.#ensureReady();
    const meta = this.#sessions.get(sessionId);
    if (meta === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', `unknown opencode session ${sessionId}`);
    }

    this.#normalizer.markPromptSent(sessionId);
    if (!(await this.#acquireSlot(sessionId))) {
      throw new StarlingError('RUNNER_ERROR', 'runner closed before the prompt could be admitted');
    }

    try {
      await this.#client.prompt(sessionId, prompt, meta.directory);
    } catch (err) {
      this.#normalizer.fail(sessionId, 'PromptRejected', describe(err));
      throw toStarlingError(err, 'RUNNER_ERROR', `could not send a prompt to ${sessionId}`);
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.#ensureReady();
    const meta = this.#sessions.get(sessionId);
    if (meta === undefined) {
      throw new StarlingError('INVALID_ARGUMENT', `unknown opencode session ${sessionId}`);
    }

    try {
      const interrupted = await this.#client.interrupt(sessionId, meta.directory);
      this.#normalizer.flush(sessionId);
      if (!interrupted) this.#normalizer.idle(sessionId);
    } finally {
      this.#releaseSlot(sessionId);
    }
  }

  onEvent(fn: (event: AgentEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;

    this.#streamAbort?.abort();
    if (this.#streamReadyTimer !== undefined) clearTimeout(this.#streamReadyTimer);
    // Release anyone awaiting the first SSE connection (a close during start() must not hang).
    this.#streamOpen?.();
    this.#streamOpen = undefined;
    this.#normalizer.flushAll();
    this.#normalizer.dispose();
    for (const sessionId of [...this.#held.keys()]) this.#releaseSlot(sessionId);

    if (this.#exitHandler !== undefined) {
      process.off('exit', this.#exitHandler);
      this.#exitHandler = undefined;
    }

    // Kill before awaiting startup: a hung `opencode serve` would otherwise hold close() open
    // until the startup timeout.
    const spawned = this.#spawned;
    this.#spawned = undefined;
    if (spawned !== undefined) {
      try {
        spawned.process.kill('SIGTERM');
      } catch {
        // Already exited.
      }
      const outcome = await Promise.race([spawned.process.exited, sleep(3_000).then(() => 'timeout')]);
      if (outcome === 'timeout') {
        try {
          spawned.process.kill('SIGKILL');
        } catch {
          // Already exited between the timeout and the kill.
        }
        await Promise.race([spawned.process.exited, sleep(1_000)]);
      }
    }

    // Never rejects: startup failures are stored in #startupError.
    await this.#ready;
  }

  #makeClient(): OpencodeClient {
    return new OpencodeClient({
      baseUrl: this.#baseUrl,
      password: this.#password,
      fetch: this.#fetch,
      timeoutMs: 10_000,
      onMalformedFrame: (raw) =>
        this.#log('warn', `ignored malformed opencode event frame: ${raw.slice(0, 200)}`),
    });
  }

  async #startup(): Promise<void> {
    const spawned = this.#spawned;
    if (spawned === undefined) return;
    try {
      const url = await this.#withTimeout(
        spawned.listening,
        this.#startupTimeoutMs,
        'opencode serve did not print its listening URL',
      );
      this.#baseUrl = url.replace(/\/+$/, '');
      this.#client = this.#makeClient();
      await this.#waitHealthy();
    } catch (err) {
      this.#startupError = toStarlingError(
        err,
        'RUNNER_ERROR',
        `opencode server failed to start: ${describe(err)}`,
      );
      this.#log('error', this.#startupError.message);
    }
  }

  async #waitHealthy(): Promise<void> {
    const deadline = Date.now() + this.#startupTimeoutMs;
    while (Date.now() < deadline) {
      if (this.#closed) {
        throw new StarlingError('RUNNER_ERROR', 'runner closed during startup');
      }
      if (await this.#probe()) return;
      await sleep(this.#healthPollMs);
    }
    throw new StarlingError(
      'RUNNER_ERROR',
      `opencode server did not become healthy within ${this.#startupTimeoutMs} ms`,
    );
  }

  async #probe(): Promise<boolean> {
    try {
      await this.#client.serverInfo();
      return true;
    } catch {
      return false;
    }
  }

  async #ensureReady(): Promise<void> {
    await this.#ready;
    if (this.#startupError !== undefined) throw this.#startupError;
    if (this.#closed) throw new StarlingError('RUNNER_ERROR', 'runner is closed');
  }

  #withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new StarlingError('RUNNER_ERROR', `${message} (after ${ms} ms)`));
      }, ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  async #admit(sessionId: string, prompt: string, directory: string): Promise<void> {
    if (!(await this.#acquireSlot(sessionId))) return;
    try {
      await this.#client.prompt(sessionId, prompt, directory);
    } catch (err) {
      this.#normalizer.fail(sessionId, 'PromptRejected', describe(err));
      this.#log('error', `prompt for ${sessionId} was rejected: ${describe(err)}`, sessionId);
    }
  }

  async #acquireSlot(sessionId: string): Promise<boolean> {
    const existing = this.#held.get(sessionId);
    if (existing !== undefined) return (await existing) !== undefined;

    const pending = this.#slots.acquire().then((release) => {
      if (this.#closed) {
        release();
        return undefined;
      }
      return release;
    });
    this.#held.set(sessionId, pending);
    const release = await pending;
    if (release === undefined) {
      this.#held.delete(sessionId);
      return false;
    }
    return true;
  }

  #releaseSlot(sessionId: string): void {
    const pending = this.#held.get(sessionId);
    if (pending === undefined) return;
    this.#held.delete(sessionId);
    void pending.then((release) => release?.());
  }

  #ensureStream(): Promise<void> {
    if (this.#streamReady !== undefined) return this.#streamReady;

    let open: () => void = () => {};
    this.#streamReady = new Promise<void>((resolve) => {
      open = resolve;
    });
    this.#streamOpen = open;
    this.#streamReadyTimer = setTimeout(open, this.#streamReadyTimeoutMs);
    void this.#streamLoop(() => {
      if (this.#streamReadyTimer !== undefined) clearTimeout(this.#streamReadyTimer);
      this.#streamReadyTimer = undefined;
      open();
    });
    return this.#streamReady;
  }

  async #streamLoop(onOpen: () => void): Promise<void> {
    let delay = this.#reconnect.minMs;
    let opened = false;

    while (!this.#closed) {
      const abort = new AbortController();
      this.#streamAbort = abort;
      try {
        const body = await this.#client.openEventStream(abort.signal);
        if (!opened) {
          opened = true;
          onOpen();
        }
        delay = this.#reconnect.minMs;
        for await (const message of readSse(body, abort.signal)) {
          const envelope = this.#client.parseEvent(message.data);
          if (envelope !== undefined) this.#normalizer.handle(envelope);
        }
        if (!this.#closed) this.#log('warn', 'opencode event stream ended; reconnecting');
      } catch (err) {
        if (this.#closed || abort.signal.aborted) break;
        this.#log('warn', `opencode event stream dropped (${describe(err)}); retrying in ${delay} ms`);
      }

      if (this.#closed) break;
      await sleep(delay, abort.signal);
      if (this.#closed) break;
      delay = Math.min(this.#reconnect.maxMs, Math.round(delay * this.#reconnect.factor));
      await this.#resync();
    }
  }

  async #resync(): Promise<void> {
    if (this.#closed) return;
    try {
      const active = await this.#client.activeSessions();
      this.#normalizer.resync(new Set(Object.keys(active)));
    } catch (err) {
      this.#log('warn', `could not resync opencode session state: ${describe(err)}`);
    }
  }

  #emit(sessionId: string, kind: AgentEventKind, data: Record<string, unknown>): void {
    const meta = this.#sessions.get(sessionId);
    if (meta === undefined) return;

    const event: AgentEvent = {
      runId: meta.runId,
      taskKey: meta.taskKey,
      sessionId,
      ts: this.#clock.now(),
      kind,
      data,
    };

    if (kind === 'session.idle' || kind === 'session.error') this.#releaseSlot(sessionId);

    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (err) {
        this.#log('warn', `agent event listener threw: ${describe(err)}`, meta.taskKey);
      }
    }
  }

  #log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, taskKey?: string): void {
    if (this.#bus === undefined) return;
    const payload: { level: typeof level; msg: string; taskKey?: string } = { level, msg };
    if (taskKey !== undefined) payload.taskKey = taskKey;
    this.#bus.publish({ type: 'log', runId: '*', ts: this.#clock.now(), payload });
  }
}

/**
 * Create a runner. Synchronous by design: in spawn mode the port and URL are known before the
 * server is healthy, so `url()` is usable immediately and `start()` awaits readiness.
 */
export function createOpencodeRunner(options: OpencodeRunnerOptions): OpencodeRunner {
  return new OpencodeRunnerImpl(options);
}
