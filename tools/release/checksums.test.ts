/**
 * `SHA256SUMS` formatting, parsing and verification.
 *
 * Hashing is the real `node:crypto`, over tiny temp files — no fixtures with pretend digests, because
 * the whole point of this file is that the installer's check and ours agree.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatChecksums, parseChecksums, sha256File, verifyChecksums } from './checksums.ts';
import { removeDir } from './fs-util.ts';

/** sha256("abc"), the canonical NIST vector. */
const ABC_SHA = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'starling-release-sums-'));
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => removeDir(dir)));
});

describe('sha256File', () => {
  test('matches the canonical sha256("abc") vector', async () => {
    const dir = await tempDir();
    const file = join(dir, 'abc.txt');
    await writeFile(file, 'abc');
    expect(await sha256File(file)).toBe(ABC_SHA);
  });

  test('empty files hash to the empty-string digest', async () => {
    const dir = await tempDir();
    const file = join(dir, 'empty.txt');
    await writeFile(file, '');
    expect(await sha256File(file)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('formatChecksums', () => {
  test('writes "<hex>  <name>" sorted by name, with a trailing newline', () => {
    const text = formatChecksums([
      { name: 'b.tar.gz', sha256: 'b'.repeat(64) },
      { name: 'a.tar.gz', sha256: 'a'.repeat(64) },
    ]);
    expect(text).toBe(`${'a'.repeat(64)}  a.tar.gz\n${'b'.repeat(64)}  b.tar.gz\n`);
  });

  test('an empty list is an empty file, not a lone newline', () => {
    expect(formatChecksums([])).toBe('');
  });

  test('round-trips through the parser', () => {
    const entries = [{ name: 'starling-0.1.0-linux-x64.tar.gz', sha256: ABC_SHA }];
    expect(parseChecksums(formatChecksums(entries))).toEqual(entries);
  });
});

describe('parseChecksums', () => {
  test('ignores blank lines and the sha256sum binary marker', () => {
    const text = `${ABC_SHA}  a.tar.gz\n\n${ABC_SHA} *b.tar.gz\n`;
    expect(parseChecksums(text)).toEqual([
      { name: 'a.tar.gz', sha256: ABC_SHA },
      { name: 'b.tar.gz', sha256: ABC_SHA },
    ]);
  });

  test('rejects a short digest with the line number', () => {
    expect(() => parseChecksums(`${ABC_SHA.slice(0, 32)}  a.tar.gz`)).toThrow(/line 1/);
  });

  test('rejects a line without a name', () => {
    expect(() => parseChecksums(`${ABC_SHA}  `)).toThrow(/not "<64 hex> {2}<name>"/);
  });
});

describe('verifyChecksums', () => {
  test('passes when the file matches', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'abc.txt'), 'abc');
    const result = await verifyChecksums([{ name: 'abc.txt', sha256: ABC_SHA }], dir);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.entries[0]?.actual).toBe(ABC_SHA);
  });

  test('fails and reports the mismatch, without throwing', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'abc.txt'), 'not abc');
    const result = await verifyChecksums([{ name: 'abc.txt', sha256: ABC_SHA }], dir);
    expect(result.ok).toBe(false);
    expect(result.entries[0]?.ok).toBe(false);
    expect(result.missing).toEqual([]);
  });

  test('fails and names the missing asset', async () => {
    const dir = await tempDir();
    const result = await verifyChecksums([{ name: 'gone.tar.gz', sha256: ABC_SHA }], dir);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['gone.tar.gz']);
  });

  test('checks every entry, not just the first', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'a.txt'), 'abc');
    await writeFile(join(dir, 'b.txt'), 'wrong');
    const result = await verifyChecksums(
      [
        { name: 'a.txt', sha256: ABC_SHA },
        { name: 'b.txt', sha256: ABC_SHA },
      ],
      dir,
    );
    expect(result.entries.map((entry) => entry.ok)).toEqual([true, false]);
    expect(result.ok).toBe(false);
  });
});
