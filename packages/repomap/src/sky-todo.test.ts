import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRepoMapper } from './mapper';
import { initRepo, makeTempDir, removeDir } from './test-helpers';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const SKY_TODO = join(REPO_ROOT, 'examples/sky-todo');
const FIXTURE = join(REPO_ROOT, 'fixtures/repomaps/sky-todo.json');

interface Fixture {
  languages: Record<string, number>;
  testCommand: string;
  files: Array<{ path: string; lang: string }>;
}

async function copySkyTodo(): Promise<string> {
  const parent = await makeTempDir('starling-sky-todo-');
  const root = join(parent, 'sky-todo');
  await cp(SKY_TODO, root, { recursive: true });
  await initRepo(root);
  return parent;
}

describe('sky-todo (the demo target)', () => {
  test('shape matches fixtures/repomaps/sky-todo.json', async () => {
    const parent = await copySkyTodo();
    try {
      const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
      const map = await createRepoMapper().map(join(parent, 'sky-todo'));

      for (const [lang, count] of Object.entries(fixture.languages)) {
        expect(map.languages[lang] ?? 0).toBeGreaterThanOrEqual(count);
      }
      // The demo repo grew after the fixture was generated; the fixture's language set is a floor.
      expect(map.languages.typescript).toBeGreaterThanOrEqual(fixture.languages.typescript ?? 0);
      expect(map.languages.html).toBeGreaterThanOrEqual(1);
      expect(map.testCommand).toBe('bun run test');
      expect(fixture.testCommand).toContain('test');
      expect(map.tokenEstimate).toBeGreaterThan(0);
    } finally {
      await removeDir(parent);
    }
  });

  test('finds exported symbols in src/lib/dates.ts', async () => {
    const parent = await copySkyTodo();
    try {
      const map = await createRepoMapper().map(join(parent, 'sky-todo'));
      const dates = map.files.find((file) => file.path === 'src/lib/dates.ts');
      expect(dates?.lang).toBe('typescript');
      expect(dates?.symbols).toContain('formatIso');
      expect(dates?.symbols).toContain('sortByDue');
      expect(dates?.symbols).toContain('DateInput');
      expect(map.tree).toContain('dates.ts');
      expect(map.tree).toContain('lib/');
    } finally {
      await removeDir(parent);
    }
  });

  test('includes the feature folders a planner would target', async () => {
    const parent = await copySkyTodo();
    try {
      const map = await createRepoMapper().map(join(parent, 'sky-todo'));
      const paths = map.files.map((file) => file.path);
      expect(paths).toContain('src/features/index.ts');
      expect(paths).toContain('src/features/registry.ts');
      expect(paths).toContain('src/ui/render.ts');
      expect(paths).not.toContain('bun.lock');
    } finally {
      await removeDir(parent);
    }
  });
});
