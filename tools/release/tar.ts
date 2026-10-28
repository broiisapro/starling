/**
 * Tarball creation with as much determinism as the platform's tar allows.
 *
 * GNU tar can pin mtime, owner, group and entry order; bsdtar (macOS) cannot. The flags are therefore
 * *detected*, never assumed: a `--sort` flag handed to bsdtar is a hard error, and a macOS build
 * should still produce a working release. The only thing that differs between the two is byte-level
 * reproducibility, which is documented as a limitation in the epic doc.
 */
import type { ExecFn } from './exec.ts';

export type TarFlavor = 'gnu' | 'bsd' | 'unknown';

/** GNU tar's reproducible-archive flags: fixed mtime, root ownership, name-sorted entries. */
export const GNU_DETERMINISTIC_FLAGS = [
  '--sort=name',
  '--mtime=@0',
  '--owner=0',
  '--group=0',
  '--numeric-owner',
] as const;

/**
 * Ask tar who it is. `tar --version` prints `tar (GNU tar) 1.35` on Linux and `bsdtar 3.5.3 …` on
 * macOS. An unrecognised (or missing) tar falls back to portable flags rather than failing the build.
 */
export async function detectTarFlavor(exec: ExecFn, cwd: string): Promise<TarFlavor> {
  const result = await exec(['tar', '--version'], { cwd });
  const text = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0) return 'unknown';
  if (/GNU tar/i.test(text)) return 'gnu';
  if (/bsdtar|libarchive/i.test(text)) return 'bsd';
  return 'unknown';
}

export interface TarCommandInput {
  /** Absolute path of the `.tar.gz` to write. */
  archivePath: string;
  /** Directory that contains the top-level directory being archived. */
  stagingParent: string;
  /** The single top-level directory name inside the archive. */
  topLevelDir: string;
  flavor: TarFlavor;
}

/** The argv for `tar -czf <archive> -C <parent> [deterministic flags] <top>`. */
export function tarCommand(input: TarCommandInput): string[] {
  const flags = input.flavor === 'gnu' ? [...GNU_DETERMINISTIC_FLAGS] : [];
  return ['tar', '-czf', input.archivePath, '-C', input.stagingParent, ...flags, input.topLevelDir];
}

/**
 * Environment for tar. `COPYFILE_DISABLE=1` stops macOS bsdtar from adding `._*` AppleDouble entries
 * for extended attributes, which would otherwise land inside the tarball and confuse Linux users.
 */
export const TAR_ENV: Record<string, string> = { COPYFILE_DISABLE: '1' };
