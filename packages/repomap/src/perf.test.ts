import { describe, expect, test } from 'bun:test';
import { createRepoMapper } from './mapper';
import { initRepo, makeTempDir, removeDir, writeFiles } from './test-helpers';

const FILES = 2000;
const BUDGET_MS = 2000;

describe('performance', () => {
  test(`maps ${FILES} files in under ${BUDGET_MS} ms`, async () => {
    const root = await makeTempDir('starling-repomap-perf-');
    try {
      await initRepo(root);
      const files: Record<string, string> = {};
      for (let i = 0; i < FILES; i += 1) {
        const dir = `src/module-${i % 20}`;
        files[`${dir}/file-${i}.ts`] =
          `// file ${i}\nexport function fn${i}(value: number): number { return value + ${i} }\n` +
          `export const VALUE_${i} = ${i}\n`;
      }
      await writeFiles(root, files);

      const started = performance.now();
      const map = await createRepoMapper().map(root);
      const elapsed = performance.now() - started;

      expect(map.files).toHaveLength(FILES);
      expect(map.languages.typescript).toBe(FILES);
      expect(map.files[0]?.symbols).toEqual(['fn0', 'VALUE_0']);
      expect(map.tree.length).toBeLessThanOrEqual(4000);
      expect(elapsed).toBeLessThan(BUDGET_MS);
    } finally {
      await removeDir(root);
    }
  }, 30_000);
});
