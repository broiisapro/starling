/**
 * Release targets and the asset-name contract.
 *
 * The names here are a **contract shared with the installer** (`tools/install`, Epic 152). It
 * downloads `starling-<version>-<os>-<arch>.tar.gz` from
 * `https://github.com/broiisapro/starling/releases/download/v<version>/<asset>` and expects the
 * tarball to unpack into a single top-level directory of the same name. Change one side and the
 * other silently breaks, so both epics copy this file's names verbatim.
 */
import { StarlingError } from '../../packages/core/src/index.ts';

/** Every artefact this repo can build. Bun's `--target` names are fixed by Bun itself. */
export const TARGETS = [
  { os: 'darwin', arch: 'arm64', bunTarget: 'bun-darwin-arm64' },
  { os: 'darwin', arch: 'x64', bunTarget: 'bun-darwin-x64' },
  { os: 'linux', arch: 'x64', bunTarget: 'bun-linux-x64' },
] as const;

export type Target = (typeof TARGETS)[number];
export type TargetOs = Target['os'];
export type TargetArch = Target['arch'];

/** `darwin-arm64`, `linux-x64` — the user-facing spelling used by `--target` and the manifest. */
export function targetId(target: Target): string {
  return `${target.os}-${target.arch}`;
}

/** Semver (with optional pre-release/build metadata), without the leading `v` releases are tagged with. */
export const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Release tags are `v0.1.0`; file names and the formula's `version` are `0.1.0`. Strip the `v` and
 * reject anything that is not a semver, so a typo cannot produce an undownloadable asset name.
 */
export function normalizeVersion(version: string): string {
  const trimmed = version.trim().replace(/^v/i, '');
  if (!VERSION_PATTERN.test(trimmed)) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `"${version}" is not a semver version (expected something like 0.1.0 or v0.1.0)`,
    );
  }
  return trimmed;
}

/** `starling-<version>-<os>-<arch>` — both the tarball's stem and its single top-level directory. */
export function topLevelDir(version: string, target: Target): string {
  return `starling-${normalizeVersion(version)}-${target.os}-${target.arch}`;
}

/** `starling-<version>-<os>-<arch>.tar.gz` (no leading `v` in the version). */
export function assetName(version: string, target: Target): string {
  return `${topLevelDir(version, target)}.tar.gz`;
}

/** `darwin-arm64` → the target, or a readable error listing what this repo actually ships. */
export function parseTargetId(id: string): Target {
  const wanted = id.trim().toLowerCase();
  const found = TARGETS.find((target) => targetId(target) === wanted);
  if (found === undefined) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `Unknown release target "${id}". Supported targets: ${TARGETS.map(targetId).join(', ')}`,
    );
  }
  return found;
}

/**
 * The target of the machine running the build.
 *
 * Bun reports `arm64` for Apple silicon and `x64` for Intel; Linux CI reports `x64`. There is no
 * linux-arm64 artefact yet (the installer names that combo as unsupported), so this throws with the
 * supported list instead of producing something nobody can install.
 */
export function hostTarget(platform: string = process.platform, arch: string = process.arch): Target {
  const os = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : undefined;
  const archName =
    arch === 'arm64' || arch === 'aarch64'
      ? 'arm64'
      : arch === 'x64' || arch === 'x86_64' || arch === 'amd64'
        ? 'x64'
        : undefined;
  const found =
    os !== undefined && archName !== undefined
      ? TARGETS.find((target) => target.os === os && target.arch === archName)
      : undefined;
  if (found === undefined) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `No release asset is built for ${platform}-${arch}. Supported targets: ${TARGETS.map(targetId).join(', ')}`,
    );
  }
  return found;
}

/**
 * Resolve a `--target` value: `host` (default), `all`, or one `os-arch` id.
 *
 * `host` and a fully spelled id are the only forms the test suite and the dry run use; `all` crosses
 * into Bun downloading foreign runtimes, which is why `build.ts` documents it as a manual step.
 */
export function selectTargets(spec: string, host: Target = hostTarget()): readonly Target[] {
  if (spec === 'host') return [host];
  if (spec === 'all') return TARGETS;
  return [parseTargetId(spec)];
}
