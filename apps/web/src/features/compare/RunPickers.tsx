import type { Run } from '@starling/core/browser';
import { Panel } from '../../components';
import { runStatusLabel } from '../launch';
import { SERIAL_BASELINE_LABEL } from './derive';
import { BASELINE_VALUE, runLabel } from './selection';
import { pickerValue } from './url';

/**
 * The two run pickers. A is always a recorded run; B can be another run or the synthetic serial
 * baseline. The run names are buttons so the shell can jump to the sky (`onSelectRun`).
 */
export interface RunPickersProps {
  runs: readonly Run[];
  a: Run;
  b?: Run;
  baseline: boolean;
  aNodes: number;
  bNodes: number;
  onPickA(runId: string): void;
  onPickB(value: string): void;
  onSelectRun?(runId: string): void;
}

const selectClass =
  'rounded-md border border-hairline-strong bg-surface-2 px-2 py-1.5 text-body text-ink-1 focus-visible:outline-2 focus-visible:outline-focus';
const nameClass =
  'self-start text-left text-caption underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus';

function nodeSummary(run: Run, nodes: number): string {
  return `${runStatusLabel(run.status)} · ${Object.keys(run.tasks).length} tasks · ${nodes} node${nodes === 1 ? '' : 's'}`;
}

export function RunPickers({
  runs,
  a,
  b,
  baseline,
  aNodes,
  bNodes,
  onPickA,
  onPickB,
  onSelectRun,
}: RunPickersProps) {
  return (
    <Panel title="Runs" subtitle="Click a run name to open it in the sky. Changing a picker updates the URL.">
      <div className="grid gap-3 px-[var(--spacing-panel)] py-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="compare-a" className="text-micro uppercase tracking-[0.08em] text-ink-4">
            Run A
          </label>
          <select
            id="compare-a"
            data-testid="picker-a"
            value={a.id}
            onChange={(event) => onPickA(event.target.value)}
            className={selectClass}
          >
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {runLabel(run)}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="run-name-a"
            onClick={() => onSelectRun?.(a.id)}
            className={`${nameClass} text-teal-200`}
          >
            {runLabel(a)}
          </button>
          <p className="text-micro text-ink-4">{nodeSummary(a, aNodes)}</p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="compare-b" className="text-micro uppercase tracking-[0.08em] text-ink-4">
            Run B
          </label>
          <select
            id="compare-b"
            data-testid="picker-b"
            value={pickerValue(b?.id, baseline)}
            onChange={(event) => onPickB(event.target.value)}
            className={selectClass}
          >
            <option value={BASELINE_VALUE}>Estimated baseline (serial)</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {runLabel(run)}
              </option>
            ))}
          </select>
          {b === undefined ? (
            <span data-testid="run-name-b" className="text-caption text-amber-200">
              Estimated baseline (one agent, serial)
            </span>
          ) : (
            <button
              type="button"
              data-testid="run-name-b"
              onClick={() => onSelectRun?.(b.id)}
              className={`${nameClass} text-violet-200`}
            >
              {runLabel(b)}
            </button>
          )}
          <p className="text-micro text-ink-4">
            {b === undefined ? SERIAL_BASELINE_LABEL : nodeSummary(b, bNodes)}
          </p>
        </div>
      </div>
    </Panel>
  );
}
