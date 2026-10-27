/**
 * fake-release.ts — a local stand-in for the GitHub Releases host the installer talks to.
 *
 * The installer must be trustworthy without any network: this server answers the two URL shapes
 * the script uses (`/latest/download/...` and `/download/v<version>/...`), plus `SHA256SUMS`,
 * over `Bun.serve({ port: 0 })` on loopback. Tests point `STARLING_RELEASE_BASE_URL` here and
 * assert on `requests` to prove which URLs were actually fetched (nothing else is reachable).
 *
 * It deliberately fails the way the real host can fail: assets for platforms Epic 151 does not
 * build are 404, an unknown version is 404, and `corrupt: 'checksum' | 'payload'` makes the
 * checksum gate reject a download. That is the whole point of the exercise.
 */

import { createHash } from 'node:crypto';

import { assetName, makeReleaseTarball, type PlatformSpec, SUPPORTED_PLATFORMS } from './tarball';

export type Corruption = 'none' | 'checksum' | 'payload';

export interface FakeReleaseOptions {
  /** The version published as `latest` (without a leading `v`). */
  version: string;
  /** Which platforms have assets. Defaults to Epic 151's matrix. */
  platforms?: PlatformSpec[];
  /** `checksum` publishes a wrong hash; `payload` serves altered bytes. Both must be rejected. */
  corrupt?: Corruption | boolean;
  /** Answer 404 for SHA256SUMS entirely. */
  omitSums?: boolean;
  /** Leave this platform's asset out of SHA256SUMS (the archive itself still downloads). */
  omitSumsFor?: PlatformSpec;
}

export interface FakeRelease {
  /** e.g. `http://127.0.0.1:54321` — set this as STARLING_RELEASE_BASE_URL. */
  baseUrl: string;
  version: string;
  /** Every path the installer requested, in order. Asserting here proves no other host was used. */
  requests: string[];
  /** The exact `SHA256SUMS` body served, useful for assertions. */
  sumsText: string;
  stop(): Promise<void>;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const corruptionOf = (value: FakeReleaseOptions['corrupt']): Corruption => {
  if (value === true) return 'checksum';
  if (value === false || value === undefined) return 'none';
  return value;
};

export async function startFakeRelease(opts: FakeReleaseOptions): Promise<FakeRelease> {
  const version = opts.version.replace(/^v/, '');
  const platforms = opts.platforms ?? SUPPORTED_PLATFORMS;
  const corruption = corruptionOf(opts.corrupt);
  const requests: string[] = [];

  const archives = new Map<string, { name: string; bytes: Uint8Array; sum: string }>();
  for (const platform of platforms) {
    const bytes = makeReleaseTarball(version, platform);
    archives.set(assetName(version, platform), {
      name: assetName(version, platform),
      bytes,
      sum: sha256(bytes),
    });
  }

  const sumLines: string[] = [];
  for (const archive of archives.values()) {
    if (
      opts.omitSumsFor &&
      archive.name.includes(`-${opts.omitSumsFor.os}-${opts.omitSumsFor.arch}.tar.gz`)
    ) {
      continue;
    }
    sumLines.push(`${corruption === 'checksum' ? '0'.repeat(64) : archive.sum}  ${archive.name}`);
  }
  const sumsText = `${sumLines.join('\n')}\n`;

  /** A payload corruption must still parse and extract differently from the real archive. */
  const servedBytes = (bytes: Uint8Array): Uint8Array => {
    if (corruption !== 'payload') return bytes;
    const copy = new Uint8Array(bytes);
    const last = copy.byteLength - 1;
    copy[last] = (copy[last] ?? 0) ^ 0xff;
    return copy;
  };

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url.pathname);
      const parts = url.pathname.split('/').filter((part) => part.length > 0);
      const notFound = (): Response => new Response('not found\n', { status: 404 });

      if (opts.omitSums && parts[parts.length - 1] === 'SHA256SUMS') return notFound();

      let prefix: string | undefined;
      if (parts[0] === 'latest' && parts[1] === 'download') prefix = 'latest';
      const versionMatch = /^v(.+)$/.exec(parts[1] ?? '');
      if (parts[0] === 'download' && versionMatch && versionMatch[1] === version) prefix = versionMatch[1];
      if (!prefix) return notFound();

      const file = parts[2];
      if (file === 'SHA256SUMS') {
        return new Response(sumsText, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      }
      const archive = archives.get(file ?? '');
      if (!archive) return notFound();
      return new Response(new Blob([new Uint8Array(servedBytes(archive.bytes))]), {
        headers: { 'content-type': 'application/gzip' },
      });
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    version,
    requests,
    sumsText,
    stop: async () => {
      await server.stop(true);
    },
  };
}
