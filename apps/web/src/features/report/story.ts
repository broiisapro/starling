import type { NodeInfo, Run, StarlingEvent } from '@starling/core/browser';
import { formatDuration, formatTokens } from '../../lib/format';
import type { StoryBeat, StoryKind } from './types';

/** The report is a page, not a log. Twelve beats is the most a projector audience will read. */
export const MAX_STORY_BEATS = 12;

/**
 * When the story has to be trimmed, keep the beats that explain the run rather than the first
 * twelve chronologically (which would be four node joins and no outcome).
 */
const PRIORITY: Record<StoryKind, number> = {
  finished: 100,
  plan: 90,
  repomap: 80,
  conflict: 70,
  audit: 65,
  migrated: 60,
  'node.left': 55,
  running: 50,
  merge: 45,
  log: 30,
  'node.joined': 20,
};

function nodeName(nodes: Record<string, NodeInfo>, nodeId: string): string {
  return nodes[nodeId]?.name ?? nodeId;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * The run's story in plain English: what the flock mapped, planned, ran, lost, moved, landed and
 * finally reported. Global (`runId: '*'`) flock events count only while they fall inside the run's
 * own window, so a perch joining days later never edits itself into an old report.
 *
 * Pure and deterministic: `at` is milliseconds since `run.startedAt`, never a wall-clock time.
 */
export function storyBeats(
  events: readonly StarlingEvent[],
  run: Run,
  nodes: Record<string, NodeInfo>,
): StoryBeat[] {
  const end = run.finishedAt ?? Math.max(...events.map((event) => event.ts), run.startedAt);
  const relevant = events
    .filter((event) => {
      if (event.runId === run.id) return true;
      if (event.runId !== '*') return false;
      return event.ts >= run.startedAt && event.ts <= end;
    })
    .slice()
    .sort((a, b) => a.ts - b.ts);

  const beats: Array<StoryBeat & { priority: number }> = [];
  const seen = new Set<string>();
  const online = new Set<string>();
  const mergedResults: Array<{ event: StarlingEvent; taskKey: string }> = [];
  let firstRunning = false;
  const mergedTotal = Object.values(run.tasks).filter((task) => task.status === 'merged').length;

  const push = (event: StarlingEvent, kind: StoryKind, text: string, taskKey?: string): void => {
    const key = `${kind}|${taskKey ?? ''}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    const beat: StoryBeat = { at: Math.max(0, event.ts - run.startedAt), kind, text };
    if (taskKey !== undefined) beat.taskKey = taskKey;
    beats.push({ ...beat, priority: PRIORITY[kind] });
  };

  for (const event of relevant) {
    switch (event.type) {
      case 'repomap.ready':
        push(
          event,
          'repomap',
          `Mapped ${plural(event.payload.files, 'file')} (~${formatTokens(event.payload.tokenEstimate)} tokens).`,
        );
        break;

      case 'plan.created': {
        const tasks = event.payload.plan.tasks.length;
        const errors = event.payload.issues.filter((issue) => issue.severity === 'error').length;
        const warnings = event.payload.issues.length - errors;
        const suffix =
          errors > 0
            ? ` with ${plural(errors, 'error')}${warnings > 0 ? ` and ${plural(warnings, 'warning')}` : ''} to repair.`
            : warnings > 0
              ? ` with ${plural(warnings, 'warning')}.`
              : ' and the validator found no issues.';
        push(event, 'plan', `Planned ${plural(tasks, 'task')}${suffix}`);
        break;
      }

      case 'node.joined': {
        const node = event.payload.node;
        const rejoined = online.has(node.id);
        online.add(node.id);
        if (rejoined) break; // the first join is the beat; a re-register is not news
        push(event, 'node.joined', `${node.name} joined the flock.`);
        break;
      }

      case 'node.left': {
        const { nodeId, reason } = event.payload;
        online.delete(nodeId);
        push(event, 'node.left', `${nodeName(nodes, nodeId)} left the flock — ${reason}.`);
        break;
      }

      case 'task.status': {
        if (event.payload.to !== 'running' || firstRunning) break;
        firstRunning = true;
        const nodeId = event.payload.run.nodeId;
        const where = nodeId === undefined ? 'an unnamed roost' : nodeName(nodes, nodeId);
        push(event, 'running', `${event.payload.taskKey} took off on ${where}.`, event.payload.taskKey);
        break;
      }

      case 'audit.verdict': {
        const verdict = event.payload;
        if (verdict.pass) break;
        const failed = verdict.checks.filter((check) => !check.ok).map((check) => check.name);
        const detail = failed.length === 0 ? '' : ` (${failed.join(', ')})`;
        push(
          event,
          'audit',
          `Audit failed for ${verdict.taskKey} on attempt ${verdict.attempt}${detail}.`,
          verdict.taskKey,
        );
        break;
      }

      case 'task.migrated': {
        const { taskKey, fromNode, toNode, reason } = event.payload;
        push(
          event,
          'migrated',
          `${taskKey} migrated from ${nodeName(nodes, fromNode)} to ${nodeName(nodes, toNode)} — ${reason}.`,
          taskKey,
        );
        break;
      }

      case 'merge.result': {
        const result = event.payload;
        if (result.status === 'conflict') {
          const files = result.conflictedFiles.length === 0 ? '' : `: ${result.conflictedFiles.join(', ')}`;
          push(event, 'conflict', `Merge conflict in ${result.taskKey}${files}.`, result.taskKey);
          break;
        }
        // Only the first and last landing belong in a twelve-beat story; the middle ones are noise.
        if (result.status === 'merged') mergedResults.push({ event, taskKey: result.taskKey });
        break;
      }

      case 'log': {
        if (event.payload.level !== 'warn' && event.payload.level !== 'error') break;
        push(event, 'log', `${event.payload.level}: ${event.payload.msg}`);
        break;
      }

      case 'run.finished': {
        const wall = (event.payload.run.finishedAt ?? event.ts) - event.payload.run.startedAt;
        push(event, 'finished', `Run finished in ${formatDuration(wall)}.`);
        break;
      }

      // Everything else is either already summarised (metrics, agent transcripts, status churn) or
      // additive in a newer hub (`run.status`), which this report deliberately ignores.
      default:
        break;
    }
  }

  // The landings are collected in the loop so exactly two beats (first, last) can be emitted after it.
  const firstMerged = mergedResults[0];
  const lastMerged = mergedResults.at(-1);
  if (firstMerged !== undefined) {
    const text =
      mergedResults.length === 1
        ? `Landed: ${firstMerged.taskKey}.`
        : `First landing: ${firstMerged.taskKey}.`;
    push(firstMerged.event, 'merge', text, firstMerged.taskKey);
  }
  if (lastMerged !== undefined && mergedResults.length > 1) {
    push(
      lastMerged.event,
      'merge',
      `Last landing: ${lastMerged.taskKey} (${mergedTotal}/${mergedTotal} merged).`,
      lastMerged.taskKey,
    );
  }

  const selected =
    beats.length <= MAX_STORY_BEATS
      ? beats
      : [...beats].sort((a, b) => b.priority - a.priority || a.at - b.at).slice(0, MAX_STORY_BEATS);

  return selected
    .sort((a, b) => a.at - b.at)
    .map((beat) => {
      const clean: StoryBeat = { at: beat.at, kind: beat.kind, text: beat.text };
      if (beat.taskKey !== undefined) clean.taskKey = beat.taskKey;
      return clean;
    });
}
