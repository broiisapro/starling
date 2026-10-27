import type { CliContext } from '../context';
import { renderFlock } from '../render/flock';
import { readBoolean } from './options';

/** `starling flock` — list nodes and print the join command (the flock board in one screen). */
export async function flockCommand(options: Record<string, unknown>, context: CliContext): Promise<number> {
  const composition = context.composition();
  const flock = composition.flock;
  const nodes = flock?.registry.list() ?? [];
  const join = flock?.joinInfo();

  if (readBoolean(options, 'json')) {
    context.write(JSON.stringify({ nodes, join: join ?? null }, null, 2));
    return 0;
  }

  context.write(renderFlock(nodes, join, { palette: context.palette, width: context.columns }));
  if (nodes.length > 0) {
    context.write();
    context.write(
      context.palette.dim('Every node shares one integration branch. Audit and merge stay on the hub.'),
    );
  }
  return 0;
}
