import type { LaneNode } from './derive';
import { type Rect, squarify } from './squarify';

/**
 * Nested lane layout: one squarified pass per directory level.
 *
 * A directory with enough room becomes a frame (a border, a label, and its children laid out inside
 * with padding); one that is too small collapses to a single tile so the map never draws unreadable
 * slivers. The output is flat and deterministic, which makes both rendering and keyboard navigation
 * a matter of indexing arrays.
 */

export const LANE_VIEW_WIDTH = 1_000;
export const LANE_VIEW_HEIGHT = 620;
/** Space between a frame and its children, in viewBox units. */
export const FRAME_PADDING = 2;
/** Room for a directory label at the top of a frame. */
export const FRAME_HEADER = 11;
export const MIN_FRAME_WIDTH = 46;
export const MIN_FRAME_HEIGHT = 34;

export interface LaneBox {
  node: LaneNode;
  rect: Rect;
  depth: number;
}

export interface LaneLayout {
  /** Directory frames, outermost first. */
  frames: LaneBox[];
  /** Interactive tiles (leaves, or frames too small to recurse into). */
  tiles: LaneBox[];
}

export function layoutLanes(
  nodes: readonly LaneNode[],
  rect: Rect,
  depth = 0,
  layout: LaneLayout = { frames: [], tiles: [] },
): LaneLayout {
  for (const tile of squarify(nodes, rect)) {
    const box: LaneBox = {
      node: tile.node,
      rect: { x: tile.x, y: tile.y, width: tile.width, height: tile.height },
      depth,
    };
    const frame =
      tile.node.children.length > 0 && tile.width >= MIN_FRAME_WIDTH && tile.height >= MIN_FRAME_HEIGHT;

    if (!frame) {
      layout.tiles.push(box);
      continue;
    }

    layout.frames.push(box);
    const header = tile.height >= 60 ? FRAME_HEADER : 0;
    const inner: Rect = {
      x: tile.x + FRAME_PADDING,
      y: tile.y + FRAME_PADDING + header,
      width: tile.width - FRAME_PADDING * 2,
      height: tile.height - FRAME_PADDING * 2 - header,
    };
    if (inner.width > 0 && inner.height > 0) {
      layoutLanes(tile.node.children, inner, depth + 1, layout);
    }
  }
  return layout;
}

/** The map the shell draws: root children, not the root itself. */
export function layoutLaneTree(tree: LaneNode): LaneLayout {
  return layoutLanes(tree.children, { x: 0, y: 0, width: LANE_VIEW_WIDTH, height: LANE_VIEW_HEIGHT });
}

export type ArrowDirection = 'left' | 'right' | 'up' | 'down';

function center(box: LaneBox): { x: number; y: number } {
  return { x: box.rect.x + box.rect.width / 2, y: box.rect.y + box.rect.height / 2 };
}

/**
 * Nearest tile in a direction, so arrow keys move the way the eye expects rather than in tree order.
 * Ties break on path, keeping focus deterministic.
 */
export function nearestTile(tiles: readonly LaneBox[], index: number, direction: ArrowDirection): number {
  const from = tiles[index];
  if (from === undefined) return index;
  const a = center(from);
  let best = index;
  let bestScore = Number.POSITIVE_INFINITY;

  tiles.forEach((candidate, candidateIndex) => {
    if (candidateIndex === index) return;
    const b = center(candidate);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const horizontal = direction === 'left' || direction === 'right';
    const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
    const cross = horizontal ? Math.abs(dy) : Math.abs(dx);
    const forward =
      direction === 'right' || direction === 'down' ? (horizontal ? dx : dy) : horizontal ? -dx : -dy;
    if (forward <= 0) return;
    const score = primary + cross * 2;
    if (score < bestScore || (score === bestScore && candidate.node.path < (tiles[best]?.node.path ?? ''))) {
      best = candidateIndex;
      bestScore = score;
    }
  });

  return best;
}
