import type { AgentEvent, AgentEventKind } from '@starling/core';

/**
 * Normalise the raw `AgentEvent` stream into renderable timeline entries.
 *
 * The one clever bit: a `tool.call` is paired with its next `tool.result` in the same session, so the
 * UI can render one collapsible row per tool use with a ✓/✗ badge instead of two unrelated lines.
 * Pairing happens here (not in the component) because it is pure and worth testing.
 */
export interface TimelineTool {
  name: string;
  /** One-line summary: the path, the command, or the tool name. */
  summary: string;
  ok?: boolean;
  detail?: string;
}

export interface TimelineUsage {
  input: number;
  output: number;
  cached: number;
  local: boolean;
  model?: string;
}

export interface TimelineEntry {
  id: string;
  ts: number;
  kind: AgentEventKind;
  text?: string;
  meta?: string;
  tool?: TimelineTool;
  file?: { path: string; added: number; removed: number };
  usage?: TimelineUsage;
  error?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function modelLabel(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const provider = asString(record.provider);
  const model = asString(record.model);
  if (provider && model) return `${provider}/${model}`;
  return model ?? provider;
}

/** A compact, human-readable result line for a tool result. */
export function toolResultDetail(data: Record<string, unknown>): string | undefined {
  const tests = asString(data.tests);
  if (tests) return `tests: ${tests}`;
  const bytes = asNumber(data.bytes);
  if (bytes !== undefined) return `${bytes.toLocaleString('en-US')} bytes`;
  const message = asString(data.message);
  if (message) return message;
  const output = asString(data.output);
  if (output) return output;
  const error = asString(data.error);
  if (error) return error;
  return undefined;
}

function toolCallSummary(data: Record<string, unknown>, tool: string): string {
  const command = asString(data.command);
  if (command) return `$ ${command}`;
  const path = asString(data.path);
  if (path) return path;
  return asString(data.summary) ?? tool;
}

export function buildTimeline(events: AgentEvent[]): TimelineEntry[] {
  const sorted = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.ts - b.event.ts || a.index - b.index);

  const entries: TimelineEntry[] = [];
  /** sessionId → index of the most recent unpaired tool.call entry. */
  const pendingToolCalls = new Map<string, number>();

  sorted.forEach(({ event }, position) => {
    const id = `${event.sessionId}:${event.ts}:${position}`;
    const data = event.data;
    const base = { id, ts: event.ts };

    switch (event.kind) {
      case 'session.started': {
        const nodeId = asString(data.nodeId);
        const model = modelLabel(data.model);
        entries.push({
          ...base,
          kind: event.kind,
          meta: [nodeId, model].filter((part): part is string => Boolean(part)).join(' · '),
        });
        break;
      }
      case 'text': {
        entries.push({ ...base, kind: event.kind, text: asString(data.text) ?? '' });
        break;
      }
      case 'tool.call': {
        const toolName = asString(data.tool) ?? 'tool';
        entries.push({
          ...base,
          kind: event.kind,
          tool: { name: toolName, summary: toolCallSummary(data, toolName) },
        });
        pendingToolCalls.set(event.sessionId, entries.length - 1);
        break;
      }
      case 'tool.result': {
        const ok = asBoolean(data.ok);
        const detail = toolResultDetail(data);
        const pendingIndex = pendingToolCalls.get(event.sessionId);
        const pending = pendingIndex === undefined ? undefined : entries[pendingIndex];
        if (pending?.tool) {
          pending.tool = { ...pending.tool, ok, detail };
          pendingToolCalls.delete(event.sessionId);
        } else {
          // A result with no call (a replayed stream that starts mid-session) still deserves a row.
          entries.push({
            ...base,
            kind: event.kind,
            tool: { name: 'result', summary: detail ?? 'tool result', ok, detail },
          });
        }
        break;
      }
      case 'file.edited': {
        entries.push({
          ...base,
          kind: event.kind,
          file: {
            path: asString(data.path) ?? 'unknown file',
            added: asNumber(data.added) ?? 0,
            removed: asNumber(data.removed) ?? 0,
          },
        });
        break;
      }
      case 'usage': {
        entries.push({
          ...base,
          kind: event.kind,
          usage: {
            input: asNumber(data.input) ?? 0,
            output: asNumber(data.output) ?? 0,
            cached: asNumber(data.cached) ?? 0,
            local: asBoolean(data.local) ?? false,
            model: modelLabel(data.model),
          },
        });
        break;
      }
      case 'session.idle': {
        entries.push({ ...base, kind: event.kind, meta: 'session idle' });
        break;
      }
      case 'session.error': {
        const error = asString(data.error) ?? asString(data.message) ?? 'The session ended with an error.';
        entries.push({ ...base, kind: event.kind, error });
        break;
      }
    }
  });

  return entries;
}
