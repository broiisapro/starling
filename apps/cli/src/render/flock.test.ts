import { describe, expect, test } from 'bun:test';
import { JOIN, NODES } from '../testing/fixtures';
import { renderFlock } from './flock';
import { fixedPalette, plainPalette } from './palette';

describe('renderFlock', () => {
  const plain = plainPalette();

  test('renders the roster and the join command (non-TTY snapshot)', () => {
    const text = renderFlock(NODES, JOIN, { palette: plain, width: 100 });
    expect(text).not.toContain('\x1b[');
    expect(text).toContain('Flock');
    expect(text).toContain('2 nodes');
    expect(text).toContain('hub');
    expect(text).toContain('m2-air');
    expect(text).toContain('qwen3.6:35b-a3b');
    expect(text).toContain('starling perch --hub http://localhost:7777 --code STAR-LING');
    expect(text).toMatchSnapshot();
  });

  test('colours node statuses on a TTY', () => {
    const text = renderFlock(NODES, JOIN, { palette: fixedPalette(true), width: 100 });
    expect(text).toContain('\x1b[');
    expect(text).toMatchSnapshot();
  });

  test('warns when the flock is empty', () => {
    const text = renderFlock([], undefined, { palette: plain, width: 80 });
    expect(text).toContain('No nodes yet');
    expect(text).toContain('0 nodes');
  });

  test('summarises free sessions across offline nodes', () => {
    const nodes = NODES.map((node) => ({ ...node, status: 'offline' as const, activeSessions: 0 }));
    const text = renderFlock(nodes, JOIN, { palette: plain, width: 100 });
    expect(text).toContain('0 online');
    expect(text).toContain('13 free session slots');
  });
});
