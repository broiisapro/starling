import type { NodeInfo } from '@starling/core';
import { NodeInfoSchema } from '@starling/core';
import type { CliContext } from '../context';
import type { JoinInfo } from '../handshake';
import { renderFlock } from '../render/flock';
import { readBoolean } from './options';

interface Roster {
  nodes: NodeInfo[];
  join?: JoinInfo;
  /** Set when the hub could not be reached and the roster came from the in-process composition. */
  offlineHub?: string;
}

/**
 * `starling flock` — the roster from the hub's `/api/nodes` plus the one command that adds a machine.
 *
 * The hub is the source of truth (a perch can join at any moment), so this asks the running server
 * rather than reading a local registry. `STARLING_HUB_URL` overrides the guessed URL; otherwise it is
 * `http://127.0.0.1:<server.port>` from `starling.config.yaml`.
 *
 * When no server is running the command falls back to the in-process composition, which is what makes
 * the mock demo (`starling flock` before `starling dash`) still show a roster and a join command.
 */
export async function flockCommand(options: Record<string, unknown>, context: CliContext): Promise<number> {
  const config = context.loadStarlingConfig();
  const hubUrl = normalizeHubUrl(context.env.STARLING_HUB_URL ?? `http://127.0.0.1:${config.server.port}`);
  const roster = await readRoster(hubUrl, context);

  if (readBoolean(options, 'json')) {
    context.write(
      JSON.stringify(
        {
          hubUrl,
          nodes: roster.nodes,
          join: roster.join ?? null,
          ...(roster.offlineHub === undefined ? {} : { offlineHub: roster.offlineHub }),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  context.write(renderFlock(roster.nodes, roster.join, { palette: context.palette, width: context.columns }));
  if (roster.offlineHub !== undefined) {
    context.write();
    context.write(
      context.palette.yellow(
        `! No hub answered at ${roster.offlineHub} — showing this process's own roster.`,
      ),
    );
    context.write(
      context.palette.dim('  Start the hub with `starling dash` (or `starling run`) and try again.'),
    );
  }
  if (roster.nodes.length > 0) {
    context.write();
    context.write(
      context.palette.dim('Every node shares one integration branch. Audit and merge stay on the hub.'),
    );
  }
  return 0;
}

async function readRoster(hubUrl: string, context: CliContext): Promise<Roster> {
  const fetchFn = context.deps.fetchFn ?? fetch;
  try {
    const [nodesResponse, joinResponse] = await Promise.all([
      fetchFn(`${hubUrl}/api/nodes`, { headers: { accept: 'application/json' } }),
      fetchFn(`${hubUrl}/api/flock/join`, { headers: { accept: 'application/json' } }),
    ]);
    if (!nodesResponse.ok) throw new Error(`/api/nodes answered ${nodesResponse.status}`);

    const parsed = NodeInfoSchema.array().safeParse(await nodesResponse.json());
    if (!parsed.success) throw new Error('/api/nodes did not return a NodeInfo list');

    const join = joinResponse.ok ? parseJoinInfo(await joinResponse.json()) : undefined;
    return { nodes: parsed.data, ...(join === undefined ? {} : { join }) };
  } catch {
    // A dashboard that is not running yet is the normal first-run state, not an error worth a stack.
    const flock = context.composition().flock;
    return {
      nodes: flock?.registry.list() ?? [],
      ...(flock?.joinInfo() === undefined ? {} : { join: flock.joinInfo() }),
      offlineHub: hubUrl,
    };
  }
}

function parseJoinInfo(raw: unknown): JoinInfo | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const { code, hubUrl, command } = value;
  if (typeof code !== 'string' || typeof hubUrl !== 'string' || typeof command !== 'string') {
    return undefined;
  }
  return { code, hubUrl, command };
}

function normalizeHubUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
