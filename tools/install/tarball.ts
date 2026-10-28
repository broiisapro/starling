/**
 * tarball.ts — build the release archives the installer downloads, without touching the disk.
 *
 * Epic 151 publishes `starling-<version>-<os>-<arch>.tar.gz` containing a top-level
 * `starling-<version>-<os>-<arch>/` directory with `bin/starling` and `share/starling/web/`.
 * The fake release server (and the tests) need those archives, and shelling out to `tar` would
 * make the fixture depend on the host's tar flavour. So this file writes ustar headers directly
 * and gzips them with `node:zlib` — deterministic bytes, no child processes.
 *
 * Timestamps are zero and owner ids are zero on purpose: two runs produce identical archives,
 * which keeps assertions about bytes (and checksums) stable.
 */

import { gzipSync } from 'node:zlib';

/** One member of an uncompressed tar archive. */
export interface TarEntry {
  /** Archive path, relative, e.g. `starling-1.0.0-darwin-arm64/bin/starling`. */
  path: string;
  /** UTF-8 file contents. Ignored for directories. */
  content?: string;
  /** Octal mode. Directories default to 0o755, files to 0o644. */
  mode?: number;
  /** Directory member (type `5`). */
  dir?: boolean;
}

const BLOCK = 512;
const encoder = new TextEncoder();
const CHECKSUM_OFFSET = 148;
const CHECKSUM_LENGTH = 8;

/** Write `value` as zero-padded octal into a fixed-width header field. */
function writeOctal(header: Uint8Array, offset: number, length: number, value: number): void {
  const text = Math.trunc(value).toString(8);
  if (text.length > length - 1) throw new Error(`tar field at ${offset} overflows ${length} bytes`);
  header.set(encoder.encode(text.padStart(length - 1, '0')), offset);
}

function headerFor(entry: TarEntry): Uint8Array {
  const isDir = entry.dir === true;
  const content = isDir ? new Uint8Array(0) : encoder.encode(entry.content ?? '');
  const name = entry.path;
  if (name.length > 100) throw new Error(`tar path too long (${name.length} > 100): ${name}`);

  const header = new Uint8Array(BLOCK);
  header.set(encoder.encode(name), 0);
  writeOctal(header, 100, 8, entry.mode ?? (isDir ? 0o755 : 0o644));
  writeOctal(header, 108, 8, 0); // uid
  writeOctal(header, 116, 8, 0); // gid
  writeOctal(header, 124, 12, content.byteLength);
  writeOctal(header, 136, 12, 0); // mtime: deterministic
  header.fill(0x20, CHECKSUM_OFFSET, CHECKSUM_OFFSET + CHECKSUM_LENGTH);
  header[156] = isDir ? 0x35 : 0x30; // '5' or '0'
  header.set(encoder.encode('ustar'), 257);
  header[262] = 0;
  header.set(encoder.encode('00'), 263); // ustar version
  header.set(encoder.encode('starling'), 265); // uname
  header.set(encoder.encode('starling'), 297); // gname
  writeOctal(header, 329, 8, 0); // devmajor
  writeOctal(header, 337, 8, 0); // devminor

  let sum = 0;
  for (const byte of header) sum += byte;
  const checksum = sum.toString(8).padStart(6, '0');
  header.set(encoder.encode(checksum), CHECKSUM_OFFSET);
  header[CHECKSUM_OFFSET + 6] = 0;
  header[CHECKSUM_OFFSET + 7] = 0x20;
  return header;
}

/** Concatenate tar members into one ustar archive (two zero blocks terminate it). */
export function makeTar(entries: TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    blocks.push(headerFor(entry));
    if (entry.dir !== true) {
      const content = encoder.encode(entry.content ?? '');
      blocks.push(content);
      const padding = (BLOCK - (content.byteLength % BLOCK)) % BLOCK;
      if (padding > 0) blocks.push(new Uint8Array(padding));
    }
  }
  blocks.push(new Uint8Array(BLOCK * 2));

  const total = blocks.reduce((n, block) => n + block.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.byteLength;
  }
  return out;
}

/** The release matrix Epic 151 builds (see ARCHITECTURE §7 L32 / the Wave 3 brief). */
export interface PlatformSpec {
  os: 'darwin' | 'linux';
  arch: 'arm64' | 'x64';
}

export const SUPPORTED_PLATFORMS: PlatformSpec[] = [
  { os: 'darwin', arch: 'arm64' },
  { os: 'darwin', arch: 'x64' },
  { os: 'linux', arch: 'x64' },
];

/** `starling-<version>-<os>-<arch>.tar.gz` — the shared asset-name contract with Epic 151. */
export function assetName(version: string, platform: PlatformSpec): string {
  return `starling-${version}-${platform.os}-${platform.arch}.tar.gz`;
}

/** The tarball's single top-level directory. */
export function topLevelDir(version: string, platform: PlatformSpec): string {
  return `starling-${version}-${platform.os}-${platform.arch}`;
}

/**
 * A stand-in for the real binary: prints `starling <version>`, which is what the installer's
 * final `--version` probe and the tests assert on.
 */
export function stubBinary(version: string): string {
  return [
    '#!/bin/sh',
    `# starling ${version} (fake release asset)`,
    `printf 'starling %s\\n' '${version}'`,
    '',
  ].join('\n');
}

/** The members of a release tarball, in archive order (directories first, as tar expects). */
export function releaseEntries(version: string, platform: PlatformSpec): TarEntry[] {
  const root = topLevelDir(version, platform);
  return [
    { path: `${root}/`, dir: true },
    { path: `${root}/bin/`, dir: true },
    { path: `${root}/bin/starling`, content: stubBinary(version), mode: 0o755 },
    { path: `${root}/share/`, dir: true },
    { path: `${root}/share/starling/`, dir: true },
    { path: `${root}/share/starling/web/`, dir: true },
    {
      path: `${root}/share/starling/web/index.html`,
      content: `<!doctype html><title>Starling ${version}</title><h1>Starling ${version}</h1>\n`,
    },
  ];
}

/** The gzipped archive the release server serves for one platform. */
export function makeReleaseTarball(version: string, platform: PlatformSpec): Uint8Array {
  return new Uint8Array(gzipSync(makeTar(releaseEntries(version, platform))));
}
