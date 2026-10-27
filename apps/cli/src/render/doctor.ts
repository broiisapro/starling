import type { DoctorCheck, DoctorResult } from '../doctor';
import { trimLines, truncate } from './format';
import type { Palette } from './palette';

export interface RenderDoctorOptions {
  palette: Palette;
  width?: number;
  /** e.g. `darwin/arm64 · bun 1.4.4` */
  banner?: string;
  /** Print the parallel-agent suggestion under the checks (default true). */
  showCapacity?: boolean;
}

/** Pretty ✔/✘/! report with a one-line fix under every non-ok check. */
export function renderDoctor(result: DoctorResult, options: RenderDoctorOptions): string {
  const { palette } = options;
  const width = Math.max(60, options.width ?? 100);
  const lines: string[] = [];

  lines.push(
    `${palette.bold('Starling doctor')}${options.banner === undefined ? '' : `  ${palette.dim('·')}  ${options.banner}`}`,
  );
  lines.push('');

  const nameWidth = Math.max(...result.checks.map((check) => check.name.length), 6);
  for (const check of result.checks) {
    const icon = statusIcon(check, palette);
    const name = check.name.padEnd(nameWidth);
    lines.push(`${icon} ${palette.bold(name)}  ${truncate(check.detail, width - nameWidth - 4)}`);
    if (check.hint !== undefined) {
      lines.push(`  ${' '.repeat(nameWidth)}  ${palette.dim(`fix: ${check.hint}`)}`);
    }
  }

  lines.push('');
  const parts = [
    palette.green(`✔ ${result.okCount} ok`),
    result.failCount > 0 ? palette.red(`✘ ${result.failCount} failed`) : palette.dim('✘ 0 failed'),
    result.warnCount > 0
      ? palette.yellow(`! ${result.warnCount} warning${result.warnCount === 1 ? '' : 's'}`)
      : palette.dim('! 0 warnings'),
  ];
  lines.push(parts.join(palette.dim('  ·  ')));

  if (options.showCapacity !== false && result.suggestedMaxParallel !== undefined) {
    lines.push(
      palette.dim(
        `maxParallel ${result.suggestedMaxParallel} suggested (one worker ≈ 2 GB RAM and one core, hub keeps one)`,
      ),
    );
  }

  if (!result.ok) {
    lines.push(palette.dim('Fix the ✘ items above, then re-run `starling doctor`.'));
  } else {
    lines.push(palette.dim('Ready to fly. 🐦  Try `starling plan "<goal>"`.'));
  }

  return trimLines(lines.join('\n'));
}

function statusIcon(check: DoctorCheck, palette: Palette): string {
  if (check.status === 'ok') return palette.green('✔');
  if (check.status === 'warn') return palette.yellow('!');
  return palette.red('✘');
}
