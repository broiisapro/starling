import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** One orchestrator agent run, reconstructed from `_logs/NN-slug.log`. */
export interface AgentSession {
  /** Epic number parsed from the filename, when there is one. */
  number?: string;
  slug: string;
  /** Header timestamp of the log (the agent's first line). */
  start: number;
  /** Log mtime: when the session last wrote something. */
  end: number;
  logFile: string;
}

const HEADER = /^===\s+(.+?)\s+::\s+([^\s:]+)\s+::/;

/**
 * Parse the first line of an agent log:
 * `=== Tue 27 Oct 2026 10:24:12 EDT :: 20-engine :: model … :: ui run ===`.
 */
export function parseLogHeader(line: string): { start: number; slug: string } | undefined {
  const match = HEADER.exec(line.trim());
  if (match === null) return undefined;
  const start = Date.parse(match[1] ?? '');
  const slug = match[2];
  if (!Number.isFinite(start) || slug === undefined) return undefined;
  return { start, slug };
}

/**
 * Read every `*.log` in the orchestrator log directory.
 *
 * The logs only carry a timestamp on their header, so the session end is the file's mtime: that is
 * when the agent last appended output, which is within seconds of the session closing in practice.
 * A missing directory returns `null` (the collector reports the logs as unavailable).
 */
export async function readAgentSessions(dir: string): Promise<AgentSession[] | null> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const sessions: AgentSession[] = [];
  for (const file of files) {
    if (!file.endsWith('.log')) continue;
    const path = join(dir, file);
    let firstLine: string;
    let mtimeMs: number;
    try {
      const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
      firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
      mtimeMs = info.mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const header = parseLogHeader(firstLine);
    if (header === undefined) continue;
    const number = /^(\d+)-/.exec(header.slug)?.[1];
    sessions.push({
      number: number === undefined ? undefined : number.padStart(2, '0'),
      slug: header.slug,
      start: header.start,
      end: Math.max(mtimeMs, header.start + 1),
      logFile: file,
    });
  }
  return sessions.sort((a, b) => a.start - b.start);
}

/**
 * Highest number of agent sessions that were open at the same time.
 *
 * End events sort before start events at the same millisecond, so a hand-off (one agent finishing
 * exactly as another starts) is not counted as an overlap.
 */
export function peakConcurrency(sessions: { start: number; end: number }[]): number {
  const events: { at: number; delta: number }[] = [];
  for (const session of sessions) {
    events.push({ at: session.start, delta: 1 });
    events.push({ at: Math.max(session.start, session.end), delta: -1 });
  }
  events.sort((a, b) => (a.at === b.at ? a.delta - b.delta : a.at - b.at));
  let running = 0;
  let peak = 0;
  for (const event of events) {
    running += event.delta;
    peak = Math.max(peak, running);
  }
  return peak;
}

/** Sum of session durations, in hours. */
export function agentHours(sessions: { start: number; end: number }[]): number {
  const ms = sessions.reduce((total, session) => total + Math.max(0, session.end - session.start), 0);
  return Math.round((ms / 3_600_000) * 10) / 10;
}
