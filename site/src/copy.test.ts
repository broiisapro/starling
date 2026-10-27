import { describe, expect, test } from 'bun:test';
import { copyableText } from './copy';

describe('copyableText', () => {
  test('drops comment lines and trims blank edges', () => {
    const code = {
      textContent:
        '\n# clone and install\n\ngit clone https://example.test/starling.git\ncd starling && bun install\n\n',
    };
    expect(copyableText(code)).toBe(
      'git clone https://example.test/starling.git\ncd starling && bun install',
    );
  });

  test('keeps indented shell commands but drops indented comments', () => {
    expect(copyableText({ textContent: '  # note\n  bun run starling doctor' })).toBe(
      '  bun run starling doctor',
    );
  });

  test('returns an empty string for a missing block', () => {
    expect(copyableText(null)).toBe('');
    expect(copyableText({ textContent: null })).toBe('');
  });
});
