/**
 * Formula rendering. A wrong sha256 here is worse than a missing formula: Homebrew would refuse the
 * install, and a human would have to debug a release at the worst possible moment.
 */
import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_REPO,
  type FormulaAsset,
  isCompleteFormula,
  releaseBaseUrl,
  renderFormula,
} from './formula.ts';

const sha = (char: string): string => char.repeat(64);

const FULL: FormulaAsset[] = [
  { name: 'starling-0.1.0-darwin-arm64.tar.gz', os: 'darwin', arch: 'arm64', sha256: sha('a') },
  { name: 'starling-0.1.0-darwin-x64.tar.gz', os: 'darwin', arch: 'x64', sha256: sha('b') },
  { name: 'starling-0.1.0-linux-x64.tar.gz', os: 'linux', arch: 'x64', sha256: sha('c') },
];

describe('renderFormula', () => {
  const formula = renderFormula({ version: '0.1.0', assets: FULL });

  test('is a Homebrew formula class', () => {
    expect(formula).toContain('class Starling < Formula');
    expect(formula).toContain('version "0.1.0"');
    expect(formula).toContain('license "MIT"');
  });

  test('points macOS arm at the arm asset with its sha256', () => {
    expect(formula).toContain(`url "${releaseBaseUrl('0.1.0')}/starling-0.1.0-darwin-arm64.tar.gz"`);
    expect(formula).toContain(`sha256 "${sha('a')}"`);
  });

  test('points macOS intel and Linux intel at their own assets', () => {
    expect(formula).toContain('/starling-0.1.0-darwin-x64.tar.gz');
    expect(formula).toContain(`sha256 "${sha('b')}"`);
    expect(formula).toContain('/starling-0.1.0-linux-x64.tar.gz');
    expect(formula).toContain(`sha256 "${sha('c')}"`);
  });

  test('has the on_macos/on_linux + on_arm/on_intel structure', () => {
    expect(formula).toContain('on_macos do');
    expect(formula).toContain('on_linux do');
    expect(formula).toContain('on_arm do');
    expect(formula).toContain('on_intel do');
  });

  test('installs the binary and the dashboard, and smoke-tests the binary', () => {
    expect(formula).toContain('bin.install "bin/starling"');
    expect(formula).toContain('pkgshare.install "share/starling/web"');
    expect(formula).toContain('test do');
    expect(formula).toContain('system "#{bin}/starling", "--version"');
  });

  test('leaves no unresolved placeholder', () => {
    expect(formula).not.toContain('{{');
    expect(formula).not.toContain('}}');
  });

  test('a partial build fills what it has and raises for the rest, never a fake hash', () => {
    const partial = renderFormula({ version: '0.1.0', assets: [FULL[0] as FormulaAsset] });
    expect(partial).toContain(`sha256 "${sha('a')}"`);
    expect(partial).toContain('raise "Starling 0.1.0 has no darwin-x64 build');
    expect(partial).toContain('raise "Starling 0.1.0 has no linux-x64 build');
    expect(partial).not.toContain(sha('b'));
  });

  test('honours a fork repo in homepage and download URLs', () => {
    const fork = renderFormula({ version: '1.0.0', assets: FULL, repo: 'someone/starling' });
    expect(fork).toContain('homepage "https://github.com/someone/starling"');
    expect(fork).toContain(
      'https://github.com/someone/starling/releases/download/v1.0.0/starling-0.1.0-darwin-arm64.tar.gz',
    );
  });

  test('accepts a v-prefixed version', () => {
    expect(renderFormula({ version: 'v0.1.0', assets: FULL })).toContain('version "0.1.0"');
  });

  test('throws on an unfilled placeholder in an injected template', () => {
    expect(() =>
      renderFormula({ version: '0.1.0', assets: FULL, template: 'class Starling\n  {{MYSTERY}}\nend\n' }),
    ).toThrow(/unfilled placeholder: \{\{MYSTERY\}\}/);
  });

  test('renders an injected template (the default one is not hardcoded)', () => {
    const rendered = renderFormula({
      version: '2.0.0',
      assets: FULL,
      template: 'version "{{VERSION}}" · {{REPO}}\n',
    });
    expect(rendered).toBe('version "2.0.0" · broiisapro/starling\n');
  });
});

describe('releaseBaseUrl', () => {
  test('is the release download URL the installer uses', () => {
    expect(releaseBaseUrl('0.1.0')).toBe('https://github.com/broiisapro/starling/releases/download/v0.1.0');
  });

  test('normalises a v-prefixed version', () => {
    expect(releaseBaseUrl('v1.2.3')).toContain('/download/v1.2.3');
  });

  test('defaults to the canonical repo', () => {
    expect(DEFAULT_REPO).toBe('broiisapro/starling');
  });
});

describe('isCompleteFormula', () => {
  test('true only with all three platform assets', () => {
    expect(isCompleteFormula(FULL)).toBe(true);
  });

  test('false for a host-only build', () => {
    expect(isCompleteFormula([FULL[0] as FormulaAsset])).toBe(false);
  });
});
