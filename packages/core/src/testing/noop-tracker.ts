import type { Run, TaskRun } from '../contracts';
import type { Tracker } from '../ports';

/** `Tracker` double for runs without GitHub mode: every method is a successful no-op. */
export class NoopTracker implements Tracker {
  readonly calls: Array<{ method: string; taskKey?: string }> = [];

  async syncPlan(_run: Run): Promise<Record<string, number>> {
    this.calls.push({ method: 'syncPlan' });
    return {};
  }

  async openTaskPR(_run: Run, task: TaskRun, _body: string): Promise<string | undefined> {
    this.calls.push({ method: 'openTaskPR', taskKey: task.taskKey });
    return undefined;
  }

  async onMerged(_run: Run, task: TaskRun): Promise<void> {
    this.calls.push({ method: 'onMerged', taskKey: task.taskKey });
  }

  async openFinalPR(_run: Run, _body: string): Promise<string | undefined> {
    this.calls.push({ method: 'openFinalPR' });
    return undefined;
  }
}
