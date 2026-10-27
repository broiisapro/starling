import { describe, expect, test } from 'bun:test';
import { isLockfile, isSkippedPath, langForPath } from './languages';

describe('langForPath', () => {
  test('maps the common language families', () => {
    const cases: Array<[string, string]> = [
      ['src/main.ts', 'typescript'],
      ['src/App.tsx', 'typescript'],
      ['src/util.mjs', 'javascript'],
      ['lib/thing.py', 'python'],
      ['cmd/serve.go', 'go'],
      ['crates/core/src/lib.rs', 'rust'],
      ['ios/App.swift', 'swift'],
      ['android/Main.kt', 'kotlin'],
      ['src/Main.java', 'java'],
      ['native/core.c', 'c'],
      ['native/core.cpp', 'cpp'],
      ['src/Program.cs', 'csharp'],
      ['app/models/user.rb', 'ruby'],
      ['public/index.php', 'php'],
      ['src/ui/styles.css', 'css'],
      ['src/ui/theme.scss', 'scss'],
      ['index.html', 'html'],
      ['README.md', 'markdown'],
      ['package.json', 'json'],
      ['ci.yml', 'yaml'],
      ['Cargo.toml', 'toml'],
      ['scripts/deploy.sh', 'shell'],
      ['db/schema.sql', 'sql'],
    ];
    for (const [path, lang] of cases) {
      expect({ path, lang: langForPath(path) }).toEqual({ path, lang });
    }
  });

  test('knows extensionless files by name', () => {
    expect(langForPath('Makefile')).toBe('make');
    expect(langForPath('GNUmakefile')).toBe('make');
    expect(langForPath('Dockerfile')).toBe('docker');
    expect(langForPath('Gemfile')).toBe('ruby');
    expect(langForPath('LICENSE')).toBe('text');
  });

  test('collapses flavours into families and keeps unknown extensions distinct', () => {
    expect(langForPath('a/b/c.d.ts')).toBe('typescript');
    expect(langForPath('a/b/c.test.tsx')).toBe('typescript');
    expect(langForPath('a/b/c.jsx')).toBe('javascript');
    expect(langForPath('a/b/c.weird')).toBe('other');
    expect(langForPath('.gitignore')).toBe('text');
  });
});

describe('lockfiles and skipped paths', () => {
  test('recognises lockfiles case-insensitively', () => {
    for (const path of [
      'bun.lock',
      'bun.lockb',
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'Cargo.lock',
      'poetry.lock',
      'go.sum',
      'nested/dir/Gemfile.lock',
    ]) {
      expect(isLockfile(path)).toBe(true);
    }
    expect(isLockfile('src/lock.ts')).toBe(false);
  });

  test('skips generated and vendored directories but not similarly named files', () => {
    expect(isSkippedPath('node_modules/react/index.js')).toBe(true);
    expect(isSkippedPath('dist/bundle.js')).toBe(true);
    expect(isSkippedPath('.starling/starling.db')).toBe(true);
    expect(isSkippedPath('target/debug/app')).toBe(true);
    expect(isSkippedPath('src/components/node_modules.tsx')).toBe(false);
    expect(isSkippedPath('src/dist.ts')).toBe(false);
    expect(isSkippedPath('src/main.ts')).toBe(false);
  });
});
