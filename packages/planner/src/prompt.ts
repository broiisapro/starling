/**
 * Prompt construction for the planner role. Pure functions only — no LLM, no I/O — so the text can
 * be snapshot-tested and reviewed like code.
 *
 * The system prompt encodes Starling's planning doctrine: small tasks, explicit writable lanes,
 * disjoint lanes for anything that can run in parallel, literal definitions of done, and explicit
 * out-of-scope lists. The user message carries the goal, its constraints and a rendered repo map.
 */
import type { Goal, PlanIssue, RepoMap } from '@starling/core';
import type { PlanDraft } from './draft';
import { renderRepoMap } from './render-map';

export const PLANNER_SYSTEM_PROMPT = `You are Starling's planner. You turn one coding goal and a repository map into a small DAG of tasks that a flock of coding agents can execute in parallel git worktrees without ever touching the same files.

Return exactly one JSON object. No prose, no markdown fences, no comments.

Rules:
1. Produce a small number of tasks (usually 3-8, at most the limit given in the request). Each task must be 5-25 minutes of work for one competent coding agent. If a piece is bigger, split it. If it is tiny, fold it into a neighbour.
2. "key" is kebab-case, unique in the plan, stable and short: "theme", "csv-export", "dates-fix".
3. "lane.owns" lists the globs a task may WRITE. "lane.reads" lists the globs it may READ. Paths are relative to the repo root; "**" matches everything below a directory; a glob naming a directory owns everything inside it. Use lane globs, never prose.
4. The central constraint: any two tasks that can run concurrently MUST have disjoint owns globs. Two tasks are concurrent unless one is an ancestor of the other through dependsOn (transitively). If two tasks must write the same file or directory, either merge them into one task or add a dependsOn edge so the later one starts only after the earlier one merges.
5. Prefer new files inside a feature folder (for example "src/features/<name>/**") over editing shared files. Shared files — renderers, registries, index barrels, package.json, lockfiles, build config, global styles owned by another feature — are collision magnets: at most one task owns each of them, everything else only reads them.
6. Reads are free: many tasks may read the same file. Never put a path in owns if the repository map shows another concurrent task needs to write it.
7. "deliverables" are concrete files, exported functions or user-visible behaviours the task creates or changes.
8. "definitionOfDone" items are literal, checkable steps. Every task must include the repo's test command passing plus at least one specific new test or assertion that proves the behaviour. Never write "works well", "looks good" or "is clean".
9. "outOfScope" is explicit and short. Always name the shared files or neighbouring features the task must not edit.
10. "lockedDecisions" captures repo-wide facts every worker must respect: language and framework, test runner, styling and persistence approach, package manager, conventions. Derive them from the repository map and the goal; never invent a framework the map does not show.
11. "estimateMin" is a realistic integer between 5 and 25.
12. Respect every constraint in the goal. A bug-fix task must include a regression test that fails before the fix and passes after it, and must not change formatting or unrelated behaviour.
13. If the repo map already contains a feature folder you are extending, own only that folder plus the few files the goal forces you to change. Do not plan a rewrite.
14. Never plan work that needs network access, credentials, secrets or a package the repo does not already use unless the goal explicitly asks for it.

JSON shape:
{
  "summary": "one sentence describing the decomposition and why the lanes are disjoint",
  "lockedDecisions": ["repo-wide fact every worker must restate", "..."],
  "tasks": [
    {
      "key": "kebab-case-key",
      "title": "short human title",
      "goal": "one paragraph an agent can act on without further context",
      "deliverables": ["concrete file / export / behaviour"],
      "outOfScope": ["explicit thing not to touch"],
      "definitionOfDone": ["<test command> passes", "specific new test or assertion", "observable behaviour"],
      "dependsOn": ["other-task-key"],
      "lane": { "owns": ["src/features/thing/**"], "reads": ["src/main.ts"] },
      "estimateMin": 15
    }
  ]
}`;

export interface PlanPrompt {
  system: string;
  user: string;
}

export interface PlanPromptOptions {
  minTasks?: number;
  maxTasks?: number;
}

function renderConstraints(goal: Goal): string {
  const constraints = goal.constraints.filter((entry) => entry.trim() !== '');
  if (constraints.length === 0) return '- none';
  return constraints.map((entry) => `- ${entry.trim()}`).join('\n');
}

/** Build the first-shot planner prompt: system doctrine plus the goal, constraints and repo map. */
export function buildPlanPrompt(goal: Goal, map: RepoMap, options: PlanPromptOptions = {}): PlanPrompt {
  const minTasks = options.minTasks ?? 2;
  const maxTasks = options.maxTasks ?? 12;
  const user = `# Goal
${goal.text.trim()}

# Constraints
${renderConstraints(goal)}

# Run context
Repo root: ${map.root}
Base branch: ${goal.baseBranch}
Test command: ${map.testCommand ?? 'unknown — infer from the repository map'}
Task count: between ${minTasks} and ${maxTasks} tasks.
Reminder: every task that can run concurrently must own disjoint paths; when in doubt, add a dependency instead.

# Repository map
${renderRepoMap(map)}`;

  return { system: PLANNER_SYSTEM_PROMPT, user };
}

/**
 * The third message of a repair turn: the validator's errors, written so a model can act on them
 * without seeing the internal validator code.
 */
export function buildRepairRequest(errors: PlanIssue[]): string {
  const errorLines = errors.filter((issue) => issue.severity === 'error');
  const list = errorLines.map((issue, index) => `${index + 1}. [${issue.code}] ${issue.message}`).join('\n');
  return `# Repair request
Your previous plan failed Starling's deterministic validator. Fix every error below and return the COMPLETE corrected plan as one JSON object in the same shape.

${list}

Rules that most often fix these errors:
- Concurrent tasks (no ancestor relationship through dependsOn) must have disjoint lane.owns globs. Merge the conflicting tasks, give each a distinct feature folder, or add a dependsOn edge so the later one waits.
- dependsOn may only reference keys that exist in the plan.
- The dependency graph must be acyclic.
- Every task needs at least one owns glob and at least one literal, checkable definitionOfDone item, including the test command.
- Keep the parts that were already good; do not drop unrelated tasks.`;
}

/**
 * Messages for a repair turn: original request, the rejected draft as the assistant turn, then the
 * concrete errors as the next user turn. Keeping the original request in the transcript preserves
 * the repo map and the goal without duplicating them in the repair text.
 */
export function buildRepairMessages(
  prompt: PlanPrompt,
  previous: PlanDraft,
  errors: PlanIssue[],
): { role: 'user' | 'assistant'; content: string }[] {
  return [
    { role: 'user', content: prompt.user },
    { role: 'assistant', content: JSON.stringify(previous) },
    { role: 'user', content: buildRepairRequest(errors) },
  ];
}
