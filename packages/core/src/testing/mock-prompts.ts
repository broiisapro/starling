import type { AuditVerdict, MergeResult } from '../contracts';
import type { PromptCompiler, PromptContext } from '../ports';

/** `PromptCompiler` double. Prompts are deterministic strings that name the task and branch. */
export class MockPromptCompiler implements PromptCompiler {
  readonly calls: Array<{ kind: 'worker' | 'fixer' | 'resolver'; taskKey: string }> = [];

  worker(ctx: PromptContext): string {
    this.calls.push({ kind: 'worker', taskKey: ctx.task.key });
    return `WORKER ${ctx.task.key} on ${ctx.branch}\n${ctx.task.goal}`;
  }

  fixer(ctx: PromptContext, verdict: AuditVerdict): string {
    this.calls.push({ kind: 'fixer', taskKey: ctx.task.key });
    return `FIX ${ctx.task.key} attempt ${verdict.attempt}\n${verdict.fixInstructions ?? verdict.summary}`;
  }

  resolver(ctx: PromptContext, conflict: MergeResult): string {
    this.calls.push({ kind: 'resolver', taskKey: ctx.task.key });
    return `RESOLVE ${ctx.task.key}\n${conflict.conflictedFiles.join(', ')}`;
  }
}
