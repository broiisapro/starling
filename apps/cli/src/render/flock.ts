import type { NodeInfo } from '@starling/core';
import type { JoinInfo } from '../handshake';
import { renderTable, trimLines, truncate } from './format';
import type { Palette } from './palette';
import { nodeStatusCell } from './task-status';

export interface RenderFlockOptions {
  palette: Palette;
  width?: number;
}

/** The flock roster plus the command that adds another machine to it. */
export function renderFlock(
  nodes: NodeInfo[],
  join: JoinInfo | undefined,
  options: RenderFlockOptions,
): string {
  const { palette } = options;
  const width = Math.max(60, options.width ?? 100);
  const lines: string[] = [];
  const free = nodes.reduce((sum, node) => sum + Math.max(0, node.maxSessions - node.activeSessions), 0);
  const online = nodes.filter((node) => node.status !== 'offline').length;

  lines.push(
    `${palette.bold('Flock')}  ${palette.dim('·')}  ${nodes.length} nodes  ${palette.dim('·')}  ${online} online  ${palette.dim('·')}  ${free} free session slots`,
  );
  lines.push('');

  if (nodes.length === 0) {
    lines.push(palette.yellow('! No nodes yet. Join one with the command below.'));
  } else {
    const rows = nodes.map((node) => [
      node.id === 'hub' ? `${palette.cyan(node.id)}` : node.id,
      node.kind,
      truncate(`${node.platform}/${node.arch}`, 14),
      `${node.activeSessions}/${node.maxSessions}`,
      node.localModels.length === 0
        ? palette.dim('—')
        : truncate(node.localModels.join(', '), Math.max(10, width - 72)),
      node.latencyMs === undefined ? palette.dim('—') : `${node.latencyMs}ms`,
      nodeStatusCell(palette, node.status),
    ]);
    lines.push(
      renderTable(['NODE', 'KIND', 'PLATFORM', 'SESSIONS', 'LOCAL MODELS', 'LATENCY', 'STATUS'], rows, {
        align: ['left', 'left', 'left', 'right', 'left', 'right', 'left'],
      }),
    );
  }

  if (join !== undefined) {
    lines.push('');
    lines.push(palette.bold('Join this flock'));
    lines.push(`  ${palette.cyan(join.command)}`);
    lines.push(`  ${palette.dim('code')} ${join.code}   ${palette.dim('hub')} ${join.hubUrl}`);
  }

  return trimLines(lines.join('\n'));
}
