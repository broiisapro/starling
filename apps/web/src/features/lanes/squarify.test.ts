import { describe, expect, test } from 'bun:test';
import type { LaneNode } from './derive';
import { type LaneBox, layoutLanes, layoutLaneTree, nearestTile } from './layout';
import { squarify, tileArea } from './squarify';

function lane(path: string, weight: number, children: LaneNode[] = []): LaneNode {
  return {
    path,
    name: path.split('/').at(-1) ?? path,
    children,
    owners: ['a'],
    readers: [],
    touched: 0,
    conflict: false,
    violation: false,
    weight,
    kind: children.length > 0 ? 'dir' : 'file',
    overlap: false,
  };
}

const RECT = { x: 0, y: 0, width: 100, height: 60 };

describe('squarify', () => {
  test('areas are proportional to weights within 1%', () => {
    const nodes = [lane('a', 4), lane('b', 3), lane('c', 2), lane('d', 1)];
    const total = nodes.reduce((sum, node) => sum + node.weight, 0);
    const rectArea = RECT.width * RECT.height;

    for (const tile of squarify(nodes, RECT)) {
      const expected = (tile.node.weight / total) * rectArea;
      expect(Math.abs(tileArea(tile) - expected) / expected).toBeLessThan(0.01);
    }
  });

  test('tiles do not overlap', () => {
    const tiles = squarify([lane('a', 5), lane('b', 4), lane('c', 3), lane('d', 2), lane('e', 1)], RECT);

    for (let i = 0; i < tiles.length; i += 1) {
      const a = tiles[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < tiles.length; j += 1) {
        const b = tiles[j];
        if (b === undefined) continue;
        const overlapWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const overlapHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        expect(overlapWidth * overlapHeight).toBeLessThan(1e-6);
      }
    }
  });

  test('keeps every tile inside the rect', () => {
    for (const tile of squarify([lane('a', 5), lane('b', 4), lane('c', 3)], RECT)) {
      expect(tile.x).toBeGreaterThanOrEqual(-1e-9);
      expect(tile.y).toBeGreaterThanOrEqual(-1e-9);
      expect(tile.x + tile.width).toBeLessThanOrEqual(RECT.width + 1e-9);
      expect(tile.y + tile.height).toBeLessThanOrEqual(RECT.height + 1e-9);
    }
  });

  test('is deterministic', () => {
    const nodes = [lane('a', 2), lane('b', 2), lane('c', 1)];
    expect(squarify(nodes, RECT)).toEqual(squarify(nodes, RECT));
  });

  test('a single node fills the whole rect', () => {
    const [tile] = squarify([lane('only', 7)], RECT);
    expect(tile?.x).toBe(RECT.x);
    expect(tile?.y).toBe(RECT.y);
    expect(tile?.width).toBeCloseTo(RECT.width, 9);
    expect(tile?.height).toBeCloseTo(RECT.height, 9);
  });

  test('zero weights fall back to equal shares', () => {
    const tiles = squarify([lane('a', 0), lane('b', 0)], RECT);
    expect(tiles).toHaveLength(2);
    expect(tileArea(tiles[0] as (typeof tiles)[number])).toBeCloseTo(
      tileArea(tiles[1] as (typeof tiles)[number]),
      6,
    );
  });

  test('returns nothing for an empty list or a degenerate rect', () => {
    expect(squarify([], RECT)).toEqual([]);
    expect(squarify([lane('a', 1)], { x: 0, y: 0, width: 0, height: 10 })).toEqual([]);
  });

  test('orders bigger weights first in the layout result', () => {
    const tiles = squarify([lane('small', 1), lane('big', 9)], RECT);
    expect(tiles[0]?.node.path).toBe('big');
  });
});

describe('layoutLanes', () => {
  const child = lane('src/theme/index.ts', 2);
  const inside = lane('src/theme', 2, [child]);
  const file = lane('src/dates.ts', 1);

  test('draws a directory as a frame and its files as tiles', () => {
    const layout = layoutLanes([inside, file], RECT);
    expect(layout.frames.map((frame) => frame.node.path)).toContain('src/theme');
    expect(layout.tiles.map((tile) => tile.node.path)).toContain('src/theme/index.ts');
    expect(layout.tiles.map((tile) => tile.node.path)).toContain('src/dates.ts');
  });

  test('collapses a frame that is too small to recurse into', () => {
    const layout = layoutLanes([inside], { x: 0, y: 0, width: 20, height: 10 });
    expect(layout.frames).toEqual([]);
    expect(layout.tiles.map((tile) => tile.node.path)).toEqual(['src/theme']);
  });

  test('layoutLaneTree lays out the root children', () => {
    const root = lane('', 3, [inside, file]);
    const layout = layoutLaneTree(root);
    expect(layout.frames).toHaveLength(1);
    expect(layout.tiles.length).toBeGreaterThan(0);
  });

  test('nearestTile moves right and then back left', () => {
    const boxes: LaneBox[] = [
      { node: lane('left', 1), rect: { x: 0, y: 0, width: 40, height: 40 }, depth: 0 },
      { node: lane('right', 1), rect: { x: 60, y: 0, width: 40, height: 40 }, depth: 0 },
    ];

    expect(nearestTile(boxes, 0, 'right')).toBe(1);
    expect(nearestTile(boxes, 1, 'left')).toBe(0);
    expect(nearestTile(boxes, 0, 'left')).toBe(0);
    expect(nearestTile(boxes, 1, 'up')).toBe(1);
  });
});
