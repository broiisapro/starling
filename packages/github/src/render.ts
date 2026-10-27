import type { Run, TaskRun, TaskSpec, TokenUsage } from '@starling/core';
import { shortId } from '@starling/core';
import type { WorkerHandback } from './handshake';

/** Where the run lives, so footers can link back to it. */
export interface RenderContext {
  /** `owner/name`. When present, footers link the run's issue search. */
  repo?: string;
  /** Label namespace used by the tracker. Default `starling`. */
  prefix?: string;
}

/** Extra human context the engine may forward into a task PR body. */
export interface TaskPRBodyOptions extends RenderContext {
  /** Notes from the engine (audit fix instructions, engine log, …). Rendered above the details. */
  notes?: string;
  /** Parsed `<<<STARLING_HANDBACK …` block from the worker's final message. */
  handback?: WorkerHandback;
  /** Issue this PR closes, rendered as `Closes #N` just above the footer. */
  closes?: number;
  /** Local-model usage attributed to this task. Rendered next to the API usage when known. */
  localUsage?: TokenUsage;
  /** Friendly node name (`Moksh's M2 Air`); falls back to `TaskRun.nodeId`. */
  nodeName?: string;
}

/**
 * The hidden marker that makes `syncPlan` idempotent: Starling finds its own issues by scanning the
 * bodies it created rather than trusting GitHub's search index (HTML comments are not indexed).
 */
export function taskMarker(runId: string, taskKey: string): string {
  return `<!-- starling:run=${runId} task=${taskKey} -->`;
}

/**
 * The run's issues, as a GitHub search URL. This is the closest thing GitHub has to a run page:
 * every issue and PR the tracker created carries the `starling:run-<short>` label.
 */
export function runSearchUrl(repo: string, prefix: string, runId: string): string {
  const query = encodeURIComponent(`label:${prefix}:run-${shortId(runId)}`);
  return `https://github.com/${repo}/issues?q=${query}`;
}

export function renderTaskIssue(task: TaskSpec, run: Run, ctx: RenderContext = {}): string {
  const lines: string[] = [
    taskMarker(run.id, task.key),
    '',
    `**Run** \`${run.id}\` · **Task** \`${task.key}\` · **Estimate** ${task.estimateMin} min`,
    '',
    '### Run goal',
    '',
    run.goal.text,
    '',
    '### Task goal',
    '',
    task.goal,
    '',
    '### Deliverables',
    '',
    ...bullets(task.deliverables),
    '',
    '### Definition of done',
    '',
    ...checklist(task.definitionOfDone),
    '',
    '### Lane',
    '',
    `- **Owns:** ${codeList(task.lane.owns)}`,
    `- **Reads:** ${codeList(task.lane.reads)}`,
    '',
    '### Out of scope',
    '',
    ...bullets(task.outOfScope),
    '',
    '### Dependencies',
    '',
    ...(task.dependsOn.length === 0
      ? ['_None — this task can start immediately._']
      : task.dependsOn.map((key) => `- \`${key}\``)),
    '',
    '---',
    `<sub>Planned by Starling 🐦${runLinkSuffix(ctx, run)}. Editing this issue does not change the plan.</sub>`,
  ];
  return `${lines.join('\n')}\n`;
}

export function renderTaskPRBody(task: TaskSpec, run: Run, extra: TaskPRBodyOptions = {}): string {
  const taskRun = run.tasks[task.key];
  const lines: string[] = [taskMarker(run.id, task.key), '', `## ${task.title}`, '', task.goal, ''];

  if (extra.notes !== undefined && extra.notes.trim() !== '') {
    lines.push('### Notes', '', extra.notes.trim(), '');
  }

  lines.push('### Audit verdict', '', ...renderVerdict(taskRun), '');
  lines.push('### Definition of done', '', ...renderDod(task, taskRun), '');

  if (extra.handback !== undefined) {
    lines.push(
      '### Agent handback',
      '',
      `**Status:** ${extra.handback.status}`,
      '',
      extra.handback.summary,
      '',
    );
    if (extra.handback.filesChanged.length > 0) {
      lines.push('**Files changed**', '', ...bullets(extra.handback.filesChanged), '');
    }
    if (extra.handback.testsAdded.length > 0) {
      lines.push('**Tests added**', '', ...bullets(extra.handback.testsAdded), '');
    }
    if (extra.handback.notes !== undefined && extra.handback.notes.trim() !== '') {
      lines.push('**Notes**', '', extra.handback.notes.trim(), '');
    }
  }

  lines.push('### Usage', '', ...renderUsage(taskRun, extra.localUsage), '');
  lines.push(
    `**Cost:** ${formatUsd(taskRun?.costUsd ?? 0)} API · ${localCostLabel(extra.localUsage)} local · **Attempts:** ${taskRun?.attempts ?? 0} · **Node:** ${nodeLabel(taskRun, extra.nodeName)}`,
    '',
  );

  if (extra.closes !== undefined) lines.push(`Closes #${extra.closes}`, '');

  lines.push(
    '---',
    `<sub>Branch \`${taskRun?.branch ?? task.key}\` · run ${runRef(extra, run)} · created by Starling 🐦</sub>`,
  );

  return `${lines.join('\n')}\n`;
}

export function renderFinalPRBody(run: Run, ctx: RenderContext = {}): string {
  const tasks = run.plan?.tasks ?? [];
  const rows: string[] = [];
  for (const task of tasks) {
    const taskRun = run.tasks[task.key];
    const status = taskRun?.status ?? 'pending';
    const link = taskRun?.prUrl === undefined ? '' : ` ([PR](${taskRun.prUrl}))`;
    rows.push(
      `| \`${task.key}\` | ${cell(task.title)}${link} | ${statusCell(status)} | ${nodeLabel(taskRun, undefined)} | ${taskRun?.attempts ?? 0} | ${formatUsd(taskRun?.costUsd ?? 0)} |`,
    );
  }

  const merged = tasks.filter((task) => run.tasks[task.key]?.status === 'merged').length;
  const failed = tasks.filter((task) => {
    const status = run.tasks[task.key]?.status;
    return status === 'failed' || status === 'conflict' || status === 'cancelled';
  }).length;
  const m = run.metrics;

  const lines: string[] = [
    `# ${run.goal.text}`,
    '',
    `**Run** ${runRef(ctx, run)} · **Status** ${run.status} · **Base** \`${run.goal.baseBranch}\` · **Integration** \`${run.integrationBranch ?? '(none)'}\``,
    '',
    run.plan?.summary === undefined ? '' : run.plan.summary,
    '',
    '## Tasks',
    '',
    ...(rows.length === 0
      ? ['_No planned tasks._']
      : [
          '| Task | Title | Status | Node | Attempts | Cost |',
          '| --- | --- | --- | --- | ---: | ---: |',
          ...rows,
          '',
          `**${merged} merged · ${failed} failed · ${tasks.length} planned**`,
        ]),
    '',
    '## Cost',
    '',
    '| | Input | Output | Cached | USD |',
    '| --- | ---: | ---: | ---: | ---: |',
    `| API | ${formatInt(m.apiUsage.input)} | ${formatInt(m.apiUsage.output)} | ${formatInt(m.apiUsage.cached)} | ${formatUsd(m.apiCostUsd)} |`,
    `| Local | ${formatInt(m.localUsage.input)} | ${formatInt(m.localUsage.output)} | ${formatInt(m.localUsage.cached)} | ${formatUsd(0)} |`,
    '',
    `**Saved vs API:** ${formatUsd(m.estSavedUsd)} across ${formatInt(m.localCallCount)} local calls · **Elapsed:** ${formatDuration(m.elapsedMs)}`,
    '',
    '---',
    '<sub>One goal in, a murmuration out. Created by Starling 🐦</sub>',
  ];
  return `${lines.join('\n')}\n`;
}

export function renderMergedComment(task: TaskSpec, run: Run, ctx: RenderContext = {}): string {
  const taskRun = run.tasks[task.key];
  const verdict = taskRun?.lastVerdict;
  const lines: string[] = [
    verdict?.pass ? '### ✅ Merged' : '### Merged',
    '',
    `\`${task.key}\` — ${task.title} is on \`${run.integrationBranch ?? 'the integration branch'}\`.`,
    '',
  ];

  if (verdict === undefined) {
    lines.push('_No audit verdict was recorded for this task._');
  } else {
    lines.push(
      `${verdict.pass ? '**Pass**' : '**Fail**'} on attempt ${verdict.attempt} · auditor \`${verdict.model.provider}/${verdict.model.model}\``,
      '',
      verdict.summary,
      '',
      ...renderVerdictTable(verdict),
      '',
      ...renderDod(task, taskRun),
    );
  }

  lines.push(
    '',
    `Attempts: ${taskRun?.attempts ?? 0} · Cost: ${formatUsd(taskRun?.costUsd ?? 0)} · Node: ${nodeLabel(taskRun, undefined)}`,
    '',
    `<sub>Closed by Starling 🐦${runLinkSuffix(ctx, run)}.</sub>`,
  );
  return `${lines.join('\n')}\n`;
}

// ── internals ───────────────────────────────────────────────────────────────────────────────────

function renderVerdict(taskRun: TaskRun | undefined): string[] {
  const verdict = taskRun?.lastVerdict;
  if (verdict === undefined) return ['_No audit verdict recorded yet._'];

  const lane =
    verdict.laneViolations.length === 0
      ? '_None._'
      : verdict.laneViolations.map((violation) => `- \`${violation}\``).join('\n');

  return [
    `${verdict.pass ? '**Pass** ✅' : '**Fail** ❌'} on attempt ${verdict.attempt} · auditor \`${verdict.model.provider}/${verdict.model.model}\``,
    '',
    verdict.summary,
    '',
    ...renderVerdictTable(verdict),
    '',
    `**Lane violations:** ${lane}`,
  ];
}

/**
 * The judge-facing table: one ✅/❌ row per check. The duration column only appears when the
 * auditor measured it, so recorded verdicts from before `AuditCheck.durationMs` stay tidy.
 */
function renderVerdictTable(verdict: NonNullable<TaskRun['lastVerdict']>): string[] {
  if (verdict.checks.length === 0) return ['_No checks recorded._'];
  const timed = verdict.checks.some((check) => check.durationMs !== undefined);
  if (!timed) {
    return [
      '| Check | Result | Detail |',
      '| --- | --- | --- |',
      ...verdict.checks.map(
        (check) => `| \`${cell(check.name)}\` | ${check.ok ? '✅' : '❌'} | ${cell(check.detail)} |`,
      ),
    ];
  }
  return [
    '| Check | Result | Duration | Detail |',
    '| --- | --- | ---: | --- |',
    ...verdict.checks.map(
      (check) =>
        `| \`${cell(check.name)}\` | ${check.ok ? '✅' : '❌'} | ${check.durationMs === undefined ? '—' : `${formatInt(check.durationMs)} ms`} | ${cell(check.detail)} |`,
    ),
  ];
}

/** `AuditVerdict.dod` when the auditor itemised it, otherwise the plan's unchecked checklist. */
function renderDod(task: TaskSpec, taskRun: TaskRun | undefined): string[] {
  const dod = taskRun?.lastVerdict?.dod;
  if (dod !== undefined && dod.length > 0) {
    return dod.map((item) => {
      const evidence = item.evidence === undefined ? '' : ` — _${cell(item.evidence)}_`;
      return `- [${item.met ? 'x' : ' '}] ${item.item}${evidence}`;
    });
  }
  return [
    `_The auditor did not itemise the DoD; the plan's checklist is below._`,
    '',
    ...checklist(task.definitionOfDone),
  ];
}

function renderUsage(taskRun: TaskRun | undefined, localUsage: TokenUsage | undefined): string[] {
  const api = taskRun?.usage ?? { input: 0, output: 0, cached: 0 };
  const local = localUsage;
  return [
    '| | Input | Output | Cached | USD |',
    '| --- | ---: | ---: | ---: | ---: |',
    `| API | ${formatInt(api.input)} | ${formatInt(api.output)} | ${formatInt(api.cached)} | ${formatUsd(taskRun?.costUsd ?? 0)} |`,
    `| Local | ${local === undefined ? '—' : formatInt(local.input)} | ${local === undefined ? '—' : formatInt(local.output)} | ${local === undefined ? '—' : formatInt(local.cached)} | ${formatUsd(0)} |`,
  ];
}

function localCostLabel(localUsage: TokenUsage | undefined): string {
  return localUsage === undefined ? '$0.0000 (not attributed per task)' : formatUsd(0);
}

function nodeLabel(taskRun: TaskRun | undefined, nodeName: string | undefined): string {
  const name = nodeName ?? taskRun?.nodeId;
  return name === undefined || name === '' ? '_unassigned_' : `\`${name}\``;
}

function runRef(context: RenderContext, run: Run): string {
  const repo = context.repo;
  if (repo === undefined || repo === '') return `\`${run.id}\``;
  const prefix = context.prefix ?? 'starling';
  return `[\`${shortId(run.id)}\`](${runSearchUrl(repo, prefix, run.id)})`;
}

function runLinkSuffix(context: RenderContext, run: Run): string {
  const repo = context.repo;
  if (repo === undefined || repo === '') return '';
  return ` · run ${runRef(context, run)}`;
}

function bullets(items: string[]): string[] {
  return items.length === 0 ? ['_None._'] : items.map((item) => `- ${item}`);
}

function checklist(items: string[]): string[] {
  return items.length === 0 ? ['_None._'] : items.map((item) => `- [ ] ${item}`);
}

function codeList(globs: string[]): string {
  return globs.length === 0 ? '_None._' : globs.map((glob) => `\`${glob}\``).join(', ');
}

function statusCell(status: string): string {
  if (status === 'merged') return '✅ merged';
  if (status === 'failed' || status === 'conflict' || status === 'cancelled') return `❌ ${status}`;
  return status;
}

/** Keep a value inside one markdown table cell. */
function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replaceAll('|', '\\|').trim();
}

function formatInt(value: number): string {
  const rounded = Math.max(0, Math.round(value));
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `$0.0042` for fractions of a cent, `$12.30` above a cent, never locale-dependent. */
function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0.0000';
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
