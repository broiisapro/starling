import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, loadConfig, modelFor, StarlingConfigSchema } from './config';
import { StarlingError } from './errors';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'starling-config-'));
}

describe('config', () => {
  test('defaults match ARCHITECTURE §5', () => {
    expect(defaultConfig.maxParallel).toBe(8);
    expect(defaultConfig.maxAttempts).toBe(3);
    expect(defaultConfig.integrationBranch).toBe('auto');
    expect(defaultConfig.opencode).toEqual({ mode: 'spawn', port: 4096, url: null });
    expect(defaultConfig.models.worker).toEqual({ provider: 'deepseek', model: 'deepseek-v4.1-flash' });
    expect(defaultConfig.models.auditor).toEqual({ provider: 'ollama', model: 'qwen3.6:35b-a3b' });
    expect(defaultConfig.providers.ollama?.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(defaultConfig.flock.offlineAfterMs).toBe(15000);
    expect(defaultConfig.perch.cacheDir).toBe('~/.starling/perch');
    expect(defaultConfig.budget.maxUsd).toBe(5);
    expect(defaultConfig.server.port).toBe(7777);
  });

  test('an empty config file yields the defaults', () => {
    expect(loadConfig(undefined, mkdtempSync(join(tmpdir(), 'starling-empty-')))).toEqual(defaultConfig);
  });

  test('YAML overrides merge over defaults', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, 'custom.yaml'),
      [
        'maxParallel: 2',
        'models:',
        '  auditor: { provider: ollama, model: qwen3.6:8b }',
        'budget: { maxUsd: 1.5 }',
      ].join('\n'),
    );
    const config = loadConfig('custom.yaml', dir);
    expect(config.maxParallel).toBe(2);
    expect(config.budget.maxUsd).toBe(1.5);
    expect(config.models.auditor.model).toBe('qwen3.6:8b');
    // untouched roles and sections keep defaults
    expect(config.models.worker.model).toBe('deepseek-v4.1-flash');
    expect(config.server.port).toBe(7777);
    rmSync(dir, { recursive: true, force: true });
  });

  test('starling.config.yaml in cwd is discovered', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'starling.config.yaml'), 'maxParallel: 3\n');
    expect(loadConfig(undefined, dir).maxParallel).toBe(3);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an explicit missing file is CONFIG_INVALID', () => {
    expect(() => loadConfig('nope.yaml', tempDir())).toThrow(StarlingError);
    try {
      loadConfig('nope.yaml', tempDir());
    } catch (err) {
      expect((err as StarlingError).code).toBe('CONFIG_INVALID');
    }
  });

  test('invalid values are rejected with CONFIG_INVALID', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'bad.yaml'), 'maxParallel: 0\n');
    try {
      loadConfig('bad.yaml', dir);
      throw new Error('expected loadConfig to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(StarlingError);
      expect((err as StarlingError).code).toBe('CONFIG_INVALID');
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test('a non-mapping YAML document is rejected', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'list.yaml'), '- one\n- two\n');
    expect(() => loadConfig('list.yaml', dir)).toThrow(StarlingError);
    rmSync(dir, { recursive: true, force: true });
  });

  test('modelFor resolves every role', () => {
    expect(modelFor(defaultConfig, 'planner').provider).toBe('deepseek');
    expect(modelFor(defaultConfig, 'writer').model).toBe('qwen3.6:35b-a3b');
  });

  test('the example config file parses and equals the defaults', () => {
    const config = loadConfig('starling.config.example.yaml', join(import.meta.dir, '../../..'));
    expect(StarlingConfigSchema.parse(config)).toEqual(defaultConfig);
  });
});
