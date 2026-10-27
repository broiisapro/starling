import type { RepoMap } from '../contracts';
import type { RepoMapper } from '../ports';
import { BASE_TS } from './factories';

export function makeRepoMap(overrides: Partial<RepoMap> = {}): RepoMap {
  return {
    root: '/tmp/sky-todo',
    tree: 'index.html\nsrc/\n  main.ts\n  store/\n    todos.ts',
    files: [
      { path: 'index.html', bytes: 420, lang: 'html', symbols: [] },
      {
        path: 'src/main.ts',
        bytes: 1100,
        lang: 'typescript',
        symbols: ['mount'],
        summary: 'Entry point that mounts the app.',
      },
      { path: 'src/store/todos.ts', bytes: 1600, lang: 'typescript', symbols: ['addTodo', 'toggleTodo'] },
      { path: 'src/store/todos.test.ts', bytes: 900, lang: 'typescript', symbols: [] },
    ],
    languages: { html: 1, typescript: 3 },
    testCommand: 'bun test',
    lintCommand: 'bunx biome check .',
    tokenEstimate: 900,
    createdAt: BASE_TS,
    ...overrides,
  };
}

/** Scripted `RepoMapper` double. */
export class MockRepoMapper implements RepoMapper {
  readonly calls: Array<{ repoPath: string; opts?: { summarize?: boolean; maxFiles?: number } }> = [];
  #map: RepoMap;

  constructor(map: RepoMap = makeRepoMap()) {
    this.#map = map;
  }

  setMap(map: RepoMap): void {
    this.#map = map;
  }

  async map(repoPath: string, opts?: { summarize?: boolean; maxFiles?: number }): Promise<RepoMap> {
    this.calls.push(opts === undefined ? { repoPath } : { repoPath, opts });
    return { ...this.#map, root: repoPath };
  }
}
