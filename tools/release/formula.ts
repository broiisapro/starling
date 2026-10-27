/**
 * The Homebrew formula, rendered from a template.
 *
 * The template lives in `homebrew/starling.rb.tmpl` so a human can read the shape without running
 * TypeScript; this module only fills in URLs and hashes. A release is normally built with
 * `--target all`, which fills every block. A partial build (the dry run, a host-only smoke build)
 * renders the blocks it *does* have and a readable `raise` for the rest — never a fake or missing
 * checksum, and never the wrong architecture's binary.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StarlingError } from '../../packages/core/src/index.ts';
import { normalizeVersion, type TargetArch, type TargetOs } from './targets.ts';

export const DEFAULT_REPO = 'broiisapro/starling';
export const DEFAULT_TEMPLATE_PATH = join(import.meta.dir, 'homebrew', 'starling.rb.tmpl');

export interface FormulaAsset {
  name: string;
  os: TargetOs;
  arch: TargetArch;
  sha256: string;
}

export interface RenderFormulaOptions {
  version: string;
  assets: readonly FormulaAsset[];
  /** `owner/name`; defaults to `broiisapro/starling`. */
  repo?: string;
  /** Template text, injected by tests; defaults to the packaged `.tmpl` file. */
  template?: string;
}

/** The release download base for one version, as the installer and formula both spell it. */
export function releaseBaseUrl(version: string, repo: string = DEFAULT_REPO): string {
  return `https://github.com/${repo}/releases/download/v${normalizeVersion(version)}`;
}

function findAsset(
  assets: readonly FormulaAsset[],
  os: TargetOs,
  arch: TargetArch,
): FormulaAsset | undefined {
  return assets.find((asset) => asset.os === os && asset.arch === arch);
}

/**
 * The two lines inside a platform block: `url` + `sha256`, or a `raise` naming the gap.
 *
 * The 6-space indent on the second line is deliberate — the placeholder sits at 6 spaces in the
 * template, so a missing `sha256` would otherwise sit at the wrong depth for a human reader.
 */
function platformBody(
  asset: FormulaAsset | undefined,
  version: string,
  baseUrl: string,
  os: TargetOs,
  arch: TargetArch,
): string {
  if (asset === undefined) {
    return `raise "Starling ${version} has no ${os}-${arch} build (see tools/release/targets.ts)"`;
  }
  return `url "${baseUrl}/${asset.name}"\n      sha256 "${asset.sha256}"`;
}

/** Replace every `{{KEY}}`; a leftover placeholder is a template bug, not something to ship. */
function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  const leftover = /\{\{[A-Z0-9_]+\}\}/.exec(out);
  if (leftover !== null) {
    throw new StarlingError(
      'INVALID_ARGUMENT',
      `Formula template has an unfilled placeholder: ${leftover[0]}`,
    );
  }
  return out;
}

/** Render `starling.rb` for one version from the assets a build produced. */
export function renderFormula(options: RenderFormulaOptions): string {
  const repo = options.repo ?? DEFAULT_REPO;
  const version = normalizeVersion(options.version);
  const template = options.template ?? readFileSync(DEFAULT_TEMPLATE_PATH, 'utf8');
  const baseUrl = releaseBaseUrl(version, repo);
  const body = (os: TargetOs, arch: TargetArch): string =>
    platformBody(findAsset(options.assets, os, arch), version, baseUrl, os, arch);
  return fillTemplate(template, {
    REPO: repo,
    VERSION: version,
    DARWIN_ARM64: body('darwin', 'arm64'),
    DARWIN_X64: body('darwin', 'x64'),
    LINUX_X64: body('linux', 'x64'),
  });
}

/** True when the formula covers every target this repo ships; only then is it publishable. */
export function isCompleteFormula(assets: readonly FormulaAsset[]): boolean {
  return (
    findAsset(assets, 'darwin', 'arm64') !== undefined &&
    findAsset(assets, 'darwin', 'x64') !== undefined &&
    findAsset(assets, 'linux', 'x64') !== undefined
  );
}
