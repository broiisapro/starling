import type { LaneNode } from './derive';

/**
 * Squarified treemap layout (Bruls, Huizing & van Wijk, 2000), pure and deterministic.
 *
 * The view draws the repo as nested directory frames; `squarify` is the piece that turns a row of
 * weighted siblings into rectangles whose areas are proportional to their weight and whose aspect
 * ratios stay as close to square as the row can manage. It is separated from the tree so the
 * invariants (proportional area, no overlap, inside the rect) are testable without SVG.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Tile {
  /** Repo-relative path of the node this tile represents. */
  path: string;
  node: LaneNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Item {
  node: LaneNode;
  weight: number;
  area: number;
}

function sum(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** Worst aspect ratio in a row laid out against `side`; `Infinity` for a degenerate row. */
function worstRatio(items: readonly Item[], side: number): number {
  if (items.length === 0) return Number.POSITIVE_INFINITY;
  if (side <= 0) return Number.POSITIVE_INFINITY;
  const areas = items.map((item) => item.area);
  const total = sum(areas);
  if (total <= 0) return Number.POSITIVE_INFINITY;
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  if (min <= 0) return Number.POSITIVE_INFINITY;
  return Math.max((side * side * max) / (total * total), (total * total) / (side * side * min));
}

/**
 * Lay `nodes` into `rect`. Areas are proportional to `node.weight`; zero/absent weights fall back
 * to equal shares so a fresh or degenerate plan still fills the canvas.
 */
export function squarify(nodes: readonly LaneNode[], rect: Rect): Tile[] {
  if (rect.width <= 0 || rect.height <= 0 || nodes.length === 0) return [];

  const weights = nodes.map((node) => {
    const weight = Number.isFinite(node.weight) && node.weight > 0 ? node.weight : 0;
    return weight;
  });
  const totalWeight = sum(weights);
  const equal = totalWeight <= 0;
  const scaled: Item[] = nodes
    .map((node, index) => ({
      node,
      weight: equal ? 1 : (weights[index] ?? 0),
      area: 0,
    }))
    .sort((a, b) => (b.weight === a.weight ? a.node.path.localeCompare(b.node.path) : b.weight - a.weight));

  const usableArea = rect.width * rect.height;
  const weightTotal = sum(scaled.map((item) => item.weight));
  for (const item of scaled) item.area = (item.weight / weightTotal) * usableArea;

  const free: Rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const tiles: Tile[] = [];
  let start = 0;

  while (start < scaled.length) {
    if (free.width <= 0 || free.height <= 0) {
      // Numerical exhaustion (or a zero-weight tail): park the rest at the corner rather than
      // inventing negative rectangles. Their area is zero, so they are invisible, not wrong.
      for (let index = start; index < scaled.length; index += 1) {
        const item = scaled[index];
        if (item === undefined) continue;
        tiles.push({ path: item.node.path, node: item.node, x: free.x, y: free.y, width: 0, height: 0 });
      }
      break;
    }

    const side = Math.min(free.width, free.height);
    const row: Item[] = [];
    const first = scaled[start];
    if (first === undefined) break;
    row.push(first);
    let end = start + 1;
    let currentWorst = worstRatio(row, side);

    while (end < scaled.length) {
      const next = scaled[end];
      if (next === undefined) break;
      const candidateWorst = worstRatio([...row, next], side);
      if (candidateWorst > currentWorst) break;
      row.push(next);
      currentWorst = candidateWorst;
      end += 1;
    }

    const rowArea = sum(row.map((item) => item.area));
    const right = free.x + free.width;
    const bottom = free.y + free.height;

    if (free.width >= free.height) {
      // Wide rect: a vertical strip spanning the (shorter) height, items stacked top to bottom.
      const thickness = rowArea / free.height;
      let y = free.y;
      for (const item of row) {
        const height = thickness > 0 ? item.area / thickness : 0;
        tiles.push({
          path: item.node.path,
          node: item.node,
          x: free.x,
          y,
          width: thickness,
          height: Math.min(height, Math.max(0, bottom - y)),
        });
        y += height;
      }
      free.x += thickness;
      free.width = Math.max(0, right - free.x);
    } else {
      // Tall rect: a horizontal strip spanning the (shorter) width, items left to right.
      const thickness = rowArea / free.width;
      let x = free.x;
      for (const item of row) {
        const width = thickness > 0 ? item.area / thickness : 0;
        tiles.push({
          path: item.node.path,
          node: item.node,
          x,
          y: free.y,
          width: Math.min(width, Math.max(0, right - x)),
          height: thickness,
        });
        x += width;
      }
      free.y += thickness;
      free.height = Math.max(0, bottom - free.y);
    }

    start = end;
  }

  return tiles;
}

/** Area of a tile, clamped at zero. */
export function tileArea(tile: Pick<Tile, 'width' | 'height'>): number {
  return Math.max(0, tile.width) * Math.max(0, tile.height);
}
