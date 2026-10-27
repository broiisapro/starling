import type { AuditVerdict, MergeResult, TaskRun } from '../contracts';
import type { AuditInput, Auditor, Merger } from '../ports';
import { makeAuditVerdict } from './factories';

export type MockAuditScript = Record<string, boolean | boolean[]>;

export interface MockAuditorOptions {
  /** Per task key: a fixed pass/fail, or a list consumed by attempt (1-based). */
  script?: MockAuditScript;
  /** Used when the task key is not scripted. */
  defaultPass?: boolean;
  /** Called after the verdict is built, for last-minute customisation. */
  decorate?: (verdict: AuditVerdict, input: AuditInput) => AuditVerdict;
}

/** Scripted `Auditor` double. Attempt numbers start at 1, matching the engine. */
export class MockAuditor implements Auditor {
  readonly inputs: AuditInput[] = [];
  readonly #script: MockAuditScript;
  readonly #defaultPass: boolean;
  readonly #decorate: ((verdict: AuditVerdict, input: AuditInput) => AuditVerdict) | undefined;
  readonly #attempts = new Map<string, number>();

  constructor(options: MockAuditorOptions = {}) {
    this.#script = options.script ?? {};
    this.#defaultPass = options.defaultPass ?? true;
    this.#decorate = options.decorate;
  }

  async audit(input: AuditInput): Promise<AuditVerdict> {
    this.inputs.push(input);
    const key = input.ctx.task.key;
    const attempt = input.attempt;
    this.#attempts.set(key, attempt);

    const scripted = this.#script[key];
    let pass = this.#defaultPass;
    if (typeof scripted === 'boolean') pass = scripted;
    else if (Array.isArray(scripted))
      pass = scripted[attempt - 1] ?? scripted[scripted.length - 1] ?? this.#defaultPass;

    const verdict = makeAuditVerdict({
      taskKey: key,
      attempt,
      pass,
      ts: input.run.finishedAt ?? Date.now(),
      model: { provider: 'ollama', model: 'qwen3.6:35b-a3b' },
      checks: [
        { name: 'tests', ok: pass, detail: pass ? 'bun test: pass' : 'bun test: 1 failing test' },
        { name: 'lane', ok: input.changedFiles.every((f) => f.startsWith('src/')), detail: 'lane check' },
      ],
      ...(pass
        ? {}
        : {
            fixInstructions: `Fix the failing check for ${key} and re-run bun test.`,
            summary: 'One check failed; see fix instructions.',
          }),
      ...(pass ? {} : { laneViolations: [] }),
    });
    return this.#decorate ? this.#decorate(verdict, input) : verdict;
  }

  attemptFor(taskKey: string): number | undefined {
    return this.#attempts.get(taskKey);
  }
}

export interface MockMergerOptions {
  /** Scripted results per task key, consumed in order. */
  script?: Record<string, MergeResult[]>;
  /** Used when the task key is not scripted. */
  defaultStatus?: MergeResult['status'];
}

/** Scripted `Merger` double. Returns `merged` with a fake commit unless told otherwise. */
export class MockMerger implements Merger {
  readonly calls: Array<{ repo: string; integrationBranch: string; taskKey: string }> = [];
  readonly #script: Record<string, MergeResult[]>;
  readonly #defaultStatus: MergeResult['status'];
  #merges = 0;

  constructor(options: MockMergerOptions = {}) {
    this.#script = options.script ?? {};
    this.#defaultStatus = options.defaultStatus ?? 'merged';
  }

  async merge(
    repo: string,
    integrationBranch: string,
    run: TaskRun,
    _opts: { testCommand?: string },
  ): Promise<MergeResult> {
    this.calls.push({ repo, integrationBranch, taskKey: run.taskKey });
    const scripted = this.#script[run.taskKey]?.shift();
    if (scripted !== undefined) return { ...scripted, taskKey: run.taskKey };
    this.#merges += 1;
    return {
      taskKey: run.taskKey,
      status: this.#defaultStatus,
      conflictedFiles: [],
      ...(this.#defaultStatus === 'merged' ? { commit: `mock-merge-${this.#merges}` } : {}),
      detail:
        this.#defaultStatus === 'merged'
          ? `Merged ${run.taskKey} into ${integrationBranch}`
          : `Scripted ${this.#defaultStatus} for ${run.taskKey}`,
      ts: Date.now(),
    };
  }
}
