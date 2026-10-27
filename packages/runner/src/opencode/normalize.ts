/**
 * opencode event → Starling `AgentEvent` normalisation.
 *
 * The server streams `SessionV1` events (recorded in `test/fixtures/openapi.json` and the
 * `opencode-cli.txt` version probe). This class turns them into the eight `AgentEventKind`s
 * from `@starling/core`, demultiplexed per session:
 *
 *   session.created / session.execution.started → session.started
 *   message.part.delta / message.part.updated (text) → text (debounced per session)
 *   message.part.updated (tool pending|running)  → tool.call
 *   message.part.updated (tool completed|error)  → tool.result
 *   file.edited / patch part                     → file.edited
 *   message.part.updated (step-finish)           → usage
 *   session.idle / session.status(idle)          → session.idle
 *   session.error / session.execution.failed     → session.error (+ session.idle, see below)
 *
 * **opencode 2.1.2 renamed the streaming half of that vocabulary.** A real turn streams
 * `session.text.started|delta|ended`, `session.step.started|streamed|ended`,
 * `session.reasoning.*`, `session.tool.input.started|input.ended|called|progress|success`,
 * `session.usage.updated` and `session.execution.succeeded|failed|interrupted` — no
 * `message.part.*` at all. Without the mapping below every live session produced only
 * `session.started`/`session.idle`: no agent text in the dashboard and no tokens in the cost meter.
 * Both families are handled, so recorded fixtures and live servers agree. (Evidence is in
 * `docs/epic-40-integration-captain.md`; the event names were captured from a live 2.1.2 server.)
 */
import type { AgentEventKind } from '@starling/core';
import type { ScheduledTask, Scheduler } from '../schedule';
import { timerScheduler } from '../schedule';
import type { OpencodeEventEnvelope } from './types';

export interface NormalizerSessionMeta {
  title?: string;
  model?: { provider: string; model: string };
  /** Worktree the session is scoped to; used to attribute server-wide `file.edited` events. */
  directory?: string;
}

export type NormalizerEmit = (sessionId: string, kind: AgentEventKind, data: Record<string, unknown>) => void;

export interface EventNormalizerOptions {
  /** Minimum spacing between `text` events for one session. Default 500 ms. */
  textDebounceMs?: number;
  schedule?: Scheduler;
  emit: NormalizerEmit;
}

interface SessionState {
  directory: string | undefined;
  started: boolean;
  idle: boolean;
  promptOutstanding: boolean;
  textBuffer: string;
  textTimer: ScheduledTask | undefined;
  textParts: Map<string, string>;
  emittedTextParts: Set<string>;
  seenToolCalls: Set<string>;
  /** Model opencode reported for the current step, attached to usage so the meter can price it. */
  model: { provider: string; model: string } | undefined;
}

const SUMMARY_LIMIT = 2000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function truncate(text: string): string {
  return text.length <= SUMMARY_LIMIT ? text : `${text.slice(0, SUMMARY_LIMIT)}…`;
}

/** `session.tool.success.content` is `[{type:'text', text}]`; flatten it for the drawer. */
function toolOutputText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((entry) => asString(asRecord(entry)?.text) ?? '')
    .filter((text) => text !== '')
    .join('\n');
}

function describeError(error: unknown): { name: string; message: string } {
  const record = asRecord(error);
  if (record === undefined) return { name: 'UnknownError', message: String(error) };
  const name = asString(record.name) ?? 'UnknownError';
  const data = asRecord(record.data);
  const message = asString(record.message) ?? asString(data?.message) ?? name;
  return { name, message };
}

export class EventNormalizer {
  readonly #textDebounceMs: number;
  readonly #schedule: Scheduler;
  readonly #emit: NormalizerEmit;
  readonly #sessions = new Map<string, SessionState>();

  constructor(options: EventNormalizerOptions) {
    this.#textDebounceMs = options.textDebounceMs ?? 500;
    this.#schedule = options.schedule ?? timerScheduler;
    this.#emit = options.emit;
  }

  /** Register a session and emit `session.started` immediately (never missed on reconnect). */
  register(sessionId: string, meta: NormalizerSessionMeta = {}): void {
    if (this.#sessions.has(sessionId)) return;
    const state: SessionState = {
      directory: meta.directory,
      started: true,
      idle: true,
      promptOutstanding: false,
      textBuffer: '',
      textTimer: undefined,
      textParts: new Map(),
      emittedTextParts: new Set(),
      seenToolCalls: new Set(),
      model: meta.model,
    };
    this.#sessions.set(sessionId, state);
    const data: Record<string, unknown> = {};
    if (meta.title !== undefined) data.title = meta.title;
    if (meta.model !== undefined) data.model = meta.model;
    this.#emit(sessionId, 'session.started', data);
  }

  unregister(sessionId: string): void {
    const state = this.#sessions.get(sessionId);
    if (state === undefined) return;
    this.#cancelTextTimer(state);
    this.#sessions.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  /** Call right before admitting a prompt: the next idle/error closes this turn. */
  markPromptSent(sessionId: string): void {
    const state = this.#sessions.get(sessionId);
    if (state === undefined) return;
    state.promptOutstanding = true;
    state.idle = false;
  }

  /** True while a prompt has been admitted and no idle/error has arrived yet. */
  isTurnOutstanding(sessionId: string): boolean {
    return this.#sessions.get(sessionId)?.promptOutstanding === true;
  }

  /** Report a failure that did not come from the event stream (e.g. prompt admission). */
  fail(sessionId: string, name: string, message: string): void {
    const state = this.#sessions.get(sessionId);
    if (state === undefined) return;
    this.#flushText(sessionId, state);
    this.#emit(sessionId, 'session.error', { name, message });
    // An error ends the turn. Emitting idle as well keeps the engine's state machine
    // moving (it reacts to session.idle); see docs/epic-15-runner.md.
    this.#emitIdle(sessionId, state);
  }

  /** Force an idle (used when abort finds the session was already idle). */
  idle(sessionId: string): void {
    const state = this.#sessions.get(sessionId);
    if (state !== undefined) this.#emitIdle(sessionId, state);
  }

  handle(envelope: OpencodeEventEnvelope): void {
    const data = asRecord(envelope.data);
    const explicitSessionId = asString(data?.sessionID);
    if (explicitSessionId !== undefined) {
      const state = this.#sessions.get(explicitSessionId);
      if (state !== undefined) this.#handleSessionEvent(explicitSessionId, state, envelope, data);
      return;
    }

    // `file.edited` is server-wide (its payload only has `file`), so attribute it by directory.
    // Starling gives every task its own worktree, which makes this unambiguous in practice.
    if (envelope.type === 'file.edited') {
      const path = asString(data?.file);
      const directory = envelope.location?.directory;
      if (path === undefined || directory === undefined) return;
      for (const [sessionId, state] of this.#sessions) {
        if (state.directory === directory) this.#emit(sessionId, 'file.edited', { path });
      }
    }
  }

  #handleSessionEvent(
    sessionId: string,
    state: SessionState,
    envelope: OpencodeEventEnvelope,
    data: Record<string, unknown> | undefined,
  ): void {
    switch (envelope.type) {
      case 'session.created':
      case 'session.execution.started':
        if (!state.started) {
          this.#markStarted(sessionId);
          this.#emit(sessionId, 'session.started', {});
        }
        return;

      case 'message.part.delta': {
        if (asString(data?.field) !== 'text') return;
        this.#appendText(sessionId, state, asString(data?.delta) ?? '');
        return;
      }

      case 'message.part.updated': {
        const part = asRecord(data?.part);
        if (part === undefined) return;
        this.#handlePart(sessionId, state, part);
        return;
      }

      case 'file.edited': {
        const path = asString(data?.file);
        if (path !== undefined) this.#emit(sessionId, 'file.edited', { path });
        return;
      }

      case 'session.status': {
        const status = asRecord(data?.status);
        const kind = asString(status?.type);
        if (kind === 'idle') this.#emitIdle(sessionId, state);
        else if (kind === 'busy' || kind === 'retry') state.idle = false;
        return;
      }

      case 'session.idle':
      case 'session.execution.succeeded':
      case 'session.execution.interrupted':
        this.#emitIdle(sessionId, state);
        return;

      // ── opencode 2.1.x streaming vocabulary (no message.part.* on a live server) ────────────
      case 'session.text.delta': {
        this.#appendText(sessionId, state, asString(data?.delta) ?? '');
        return;
      }

      case 'session.text.ended': {
        // The full text of one part; if the deltas were missed (a reconnect), this still lands it.
        const text = asString(data?.text);
        const had = state.textBuffer !== '';
        this.#flushText(sessionId, state);
        if (!had && text !== undefined && text !== '') this.#emit(sessionId, 'text', { text });
        return;
      }

      case 'session.step.started': {
        const model = asRecord(data?.model);
        const providerID = asString(model?.providerID);
        const id = asString(model?.id);
        if (providerID === undefined || id === undefined) return;
        state.model = { provider: providerID, model: id };
        // The engine learns the model from `session.started`; re-announcing is how a step that
        // switches model reaches the cost meter.
        this.#emit(sessionId, 'session.started', { model: state.model });
        return;
      }

      case 'session.usage.updated': {
        // `session.step.ended` carries the same totals; only this event is counted, so a turn is
        // never billed twice.
        const tokens = asRecord(data?.tokens);
        const cache = asRecord(tokens?.cache);
        this.#emit(sessionId, 'usage', {
          input: asNumber(tokens?.input) ?? 0,
          output: asNumber(tokens?.output) ?? 0,
          cached: asNumber(cache?.read) ?? 0,
          costUsd: asNumber(data?.cost) ?? 0,
          ...(state.model === undefined ? {} : { model: state.model }),
        });
        return;
      }

      case 'session.tool.input.started': {
        const callId = asString(data?.id) ?? '';
        const tool = asString(data?.name) ?? 'unknown';
        this.#announceTool(sessionId, state, callId, tool, {});
        return;
      }

      case 'session.tool.called': {
        const callId = asString(data?.id) ?? '';
        const tool = asString(data?.name) ?? 'unknown';
        this.#announceTool(sessionId, state, callId, tool, asRecord(data?.input) ?? {});
        return;
      }

      case 'session.tool.success': {
        const callId = asString(data?.id) ?? '';
        const tool = asString(data?.name) ?? 'unknown';
        this.#announceTool(sessionId, state, callId, tool, asRecord(data?.input) ?? {});
        this.#emit(sessionId, 'tool.result', {
          tool,
          ok: true,
          summary: truncate(toolOutputText(data?.content)),
          callId,
        });
        return;
      }

      case 'session.tool.failed':
      case 'session.tool.error': {
        const callId = asString(data?.id) ?? '';
        const tool = asString(data?.name) ?? 'unknown';
        this.#announceTool(sessionId, state, callId, tool, asRecord(data?.input) ?? {});
        this.#emit(sessionId, 'tool.result', {
          tool,
          ok: false,
          summary: truncate(asString(data?.error) ?? toolOutputText(data?.content) ?? 'tool failed'),
          callId,
        });
        return;
      }

      case 'session.error':
      case 'session.execution.failed': {
        const error = describeError(data?.error ?? data?.message);
        this.fail(sessionId, error.name, error.message);
        return;
      }

      default:
        // reasoning.*, step.streamed, agent/model switches, retries, compaction… are not part
        // of the Starling vocabulary. Ignoring them is deliberate, not an error.
        return;
    }
  }

  /** One `tool.call` per call id, whatever combination of events announced it. */
  #announceTool(
    sessionId: string,
    state: SessionState,
    callId: string,
    tool: string,
    args: Record<string, unknown>,
  ): void {
    const key = callId === '' ? `${tool}:${Object.keys(args).length}` : callId;
    if (state.seenToolCalls.has(key)) return;
    state.seenToolCalls.add(key);
    this.#emit(sessionId, 'tool.call', { tool, args, callId });
  }

  /** Emit an idle for every session whose turn is outstanding but no longer active. */
  resync(activeSessionIds: ReadonlySet<string>): void {
    for (const [sessionId, state] of this.#sessions) {
      if (state.promptOutstanding && !activeSessionIds.has(sessionId)) {
        this.#emitIdle(sessionId, state);
      }
    }
  }

  flush(sessionId: string): void {
    const state = this.#sessions.get(sessionId);
    if (state !== undefined) this.#flushText(sessionId, state);
  }

  flushAll(): void {
    for (const [sessionId, state] of this.#sessions) this.#flushText(sessionId, state);
  }

  dispose(): void {
    for (const state of this.#sessions.values()) this.#cancelTextTimer(state);
    this.#sessions.clear();
  }

  #markStarted(sessionId: string): void {
    const state = this.#sessions.get(sessionId);
    if (state !== undefined) state.started = true;
  }

  #handlePart(sessionId: string, state: SessionState, part: Record<string, unknown>): void {
    switch (asString(part.type)) {
      case 'text': {
        this.#handleTextPart(sessionId, state, part);
        return;
      }
      case 'tool': {
        this.#handleToolPart(sessionId, state, part);
        return;
      }
      case 'step-finish': {
        const tokens = asRecord(part.tokens);
        const cache = asRecord(tokens?.cache);
        this.#emit(sessionId, 'usage', {
          input: asNumber(tokens?.input) ?? 0,
          output: asNumber(tokens?.output) ?? 0,
          cached: asNumber(cache?.read) ?? 0,
          costUsd: asNumber(part.cost) ?? 0,
        });
        return;
      }
      case 'patch': {
        const files = part.files;
        if (!Array.isArray(files)) return;
        for (const file of files) {
          const path = asString(file);
          if (path !== undefined) this.#emit(sessionId, 'file.edited', { path });
        }
        return;
      }
      default:
        return;
    }
  }

  #handleTextPart(sessionId: string, state: SessionState, part: Record<string, unknown>): void {
    const partId = asString(part.id);
    const text = asString(part.text);
    if (partId === undefined || text === undefined) return;

    // Streaming updates repeat the whole text; append only the unseen suffix so a server
    // that sends part.updated without deltas still produces text.
    const previous = state.textParts.get(partId) ?? '';
    if (text.length > previous.length && text.startsWith(previous)) {
      this.#appendText(sessionId, state, text.slice(previous.length));
    }
    state.textParts.set(partId, text);

    const time = asRecord(part.time);
    const ended = asNumber(time?.end) !== undefined;
    if (!ended) return;

    const hadBufferedText = state.textBuffer !== '';
    this.#flushText(sessionId, state);
    if (!hadBufferedText && !state.emittedTextParts.has(partId) && text !== '') {
      state.emittedTextParts.add(partId);
      this.#emit(sessionId, 'text', { text });
    }
  }

  #handleToolPart(sessionId: string, state: SessionState, part: Record<string, unknown>): void {
    const callId = asString(part.callID) ?? asString(part.id) ?? '';
    const tool = asString(part.tool) ?? 'unknown';
    const toolState = asRecord(part.state);
    const status = asString(toolState?.status);

    const announce = () => {
      if (state.seenToolCalls.has(callId)) return;
      state.seenToolCalls.add(callId);
      this.#emit(sessionId, 'tool.call', {
        tool,
        args: toolState?.input ?? {},
        callId,
      });
    };

    if (status === 'pending' || status === 'running') {
      announce();
      return;
    }
    if (status === 'completed') {
      announce();
      this.#emit(sessionId, 'tool.result', {
        tool,
        ok: true,
        summary: truncate(asString(toolState?.output) ?? ''),
        callId,
      });
      return;
    }
    if (status === 'error') {
      announce();
      this.#emit(sessionId, 'tool.result', {
        tool,
        ok: false,
        summary: truncate(asString(toolState?.error) ?? 'tool failed'),
        callId,
      });
    }
  }

  #appendText(sessionId: string, state: SessionState, delta: string): void {
    if (delta === '') return;
    state.textBuffer += delta;
    if (state.textTimer !== undefined) return;
    state.textTimer = this.#schedule(() => {
      state.textTimer = undefined;
      this.#flushText(sessionId, state);
    }, this.#textDebounceMs);
  }

  #flushText(sessionId: string, state: SessionState): void {
    this.#cancelTextTimer(state);
    if (state.textBuffer === '') return;
    const text = state.textBuffer;
    state.textBuffer = '';
    this.#emit(sessionId, 'text', { text });
  }

  #cancelTextTimer(state: SessionState): void {
    state.textTimer?.cancel();
    state.textTimer = undefined;
  }

  #emitIdle(sessionId: string, state: SessionState): void {
    this.#flushText(sessionId, state);
    state.promptOutstanding = false;
    if (state.idle) return;
    state.idle = true;
    this.#emit(sessionId, 'session.idle', {});
  }
}
