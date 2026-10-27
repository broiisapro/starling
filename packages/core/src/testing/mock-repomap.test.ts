import { describe, expect, test } from 'bun:test';
import { MockRepoMapper, makeRepoMap } from './mock-repomap';

describe('MockRepoMapper', () => {
  test('returns the scripted map rooted at the requested path', async () => {
    const mapper = new MockRepoMapper();
    const map = await mapper.map('/repo', { summarize: true });
    expect(map.root).toBe('/repo');
    expect(map.testCommand).toBe('bun test');
    expect(mapper.calls).toEqual([{ repoPath: '/repo', opts: { summarize: true } }]);
  });

  test('setMap swaps the map and records calls without opts', async () => {
    const mapper = new MockRepoMapper();
    mapper.setMap(makeRepoMap({ tokenEstimate: 5 }));
    expect((await mapper.map('/x')).tokenEstimate).toBe(5);
    expect(mapper.calls).toEqual([{ repoPath: '/x' }]);
  });

  test('makeRepoMap describes the demo app', () => {
    const map = makeRepoMap();
    expect(map.files.map((f) => f.path)).toContain('src/store/todos.ts');
    expect(map.languages.typescript).toBeGreaterThan(0);
  });
});
