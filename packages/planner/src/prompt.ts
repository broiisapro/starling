/**
 * Prompt construction for the planner role. Pure functions only — no LLM, no I/O — so the text can
 * be snapshot-tested and reviewed like code.
 *
 * The system prompt encodes Starling's planning doctrine: small tasks, explicit writable lanes,
 * disjoint lanes for anything that can run in parallel, literal definitions of done, and explicit
 * out-of-scope lists. The user message carries the goal, its constraints and a rendered repo map.
 */
import type { Goal, PlanIssue, RepoMap } from '@starling/core';
import { renderRepoMap as renderRepomap } from '@starling/repomap';
import type { PlanDraft } from './draft';
import { renderRepoMap as renderVerboseRepoMap } from './render-map';

export const PLANNER_SYSTEM_PROMPT = `You are Starling's planner. You turn one coding goal and a repository map into a small DAG of tasks that a flock of coding agents can execute in parallel git worktrees without ever touching the same files.

Return exactly one JSON object. No prose, no markdown fences, no comments.

## What a task is
1. Make one task for every capability the goal names, and no others. A capability is one user-visible behaviour, surface or bug fix — not one file, one layer or one commit. The task count is not a target: a goal with one capability is a one-task plan.
2. Never split a capability by layer. A store change, a route and a component for the same capability are ONE task: its files move together, and splitting them only invents a fake dependency. Split only when the work for one task would take a competent agent more than 25 minutes.
3. Never create a task for wiring, integration, scaffolding, setup, refactoring, renaming, documentation, changelogs or standalone tests. Tests belong to the capability they verify. Wiring belongs to the capability that needs it and goes in that task's lane.
4. A distinct surface the goal names (a dialog, overlay, page, panel, route, CLI command) gets its own task even when it reuses another capability. A small adjacent fix in the same file is bundled into one task.
5. If two capabilities would have to write the same file, prefer merging them into one task. Otherwise give the file to the earlier task and add dependsOn so they are serialised. Never keep both as concurrent writers.
6. Keep the plan at or under the task limit in the request; "between min and max" is a ceiling, not a suggestion to pad.

## Lanes
7. "lane.owns" lists the globs a task may WRITE; "lane.reads" lists the globs it may READ. Paths are relative to the repo root; "**" matches everything below a directory; a glob naming a directory owns everything inside it. Use globs, never prose.
8. Put a new capability in its own folder: prefer "src/features/<capability>/**", or the feature/module convention the repository map already shows. When the map already contains a folder for this capability, extend that folder instead of inventing a second one. Name the folder after the capability in kebab-case.
9. Shared files are read-only by default: the app entry points that mount everything (main.ts, app.ts, server.ts, index.ts at the root of an app), the shared renderer or shell, global styles, the central data store and domain model, manifests, lockfiles and build config. Do not own them just to wire a feature in; feature folders are the integration point. Exception: the goal explicitly names the file, or asks you to fix that module's behaviour — then exactly one task owns it.
10. Do not widen a shared module's API for a single capability. Implement the behaviour at the edge (route, middleware, feature module) using the shared module as it is.
11. The central concurrency rule: any two tasks that can run concurrently MUST have disjoint owns globs. Two tasks are concurrent unless one is an ancestor of the other through dependsOn (transitively). Reads are free: many tasks may read the same file.

## Dependencies
12. Add dependsOn only when the later task consumes something the earlier task creates (an exported helper, a keybinding table, a component) or its behaviour must land after the other (a route behind a new guard). A producer must come before its consumers.
13. Never add an edge for "wiring", "documentation", "consistency", or because two tasks touch the same area, and never invent a task to hold edges. If two tasks must edit the same file, merge them instead.

## Fields
14. "key" is kebab-case, unique and short ("theme", "csv-export", "dates-fix"). Starling numbers keys t01-, t02- in dependency order, so do not number them yourself.
15. "deliverables" are concrete files, exported functions or user-visible behaviours the task creates or changes.
16. "definitionOfDone" items are literal, checkable steps. Every task must include the repo's test command passing plus at least one specific new test or assertion that proves the behaviour. Never write "works well", "looks good" or "is clean".
17. "outOfScope" is explicit and short. Always name the shared files or neighbouring features the task must not edit.
18. "lockedDecisions" captures repo-wide facts every worker must respect: language and framework, test runner, styling and persistence approach, package manager, conventions. Derive them from the repository map and the goal; never invent a framework the map does not show.
19. "estimateMin" is a realistic integer between 5 and 25.
20. Respect every constraint in the goal. A bug-fix task must include a regression test that fails before the fix and passes after it, and must not change formatting or unrelated behaviour.
21. Never plan work that needs network access, credentials, secrets or a package the repo does not already use unless the goal explicitly asks for it.

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
  /**
   * Which repo-map renderer the prompt embeds.
   *
   * `repomap` is `@starling/repomap`'s budgeted renderer (the one the prompt compiler uses too);
   * `verbose` is the planner's original per-file listing with symbols, byte counts and summaries.
   * Kept switchable because the two were compared on the real model — see
   * `docs/epic-48-planner-quality.md` — and the loser is one deleted file away from being gone.
   */
  mapRenderer?: MapRenderer;
}

export type MapRenderer = 'repomap' | 'verbose';

export const DEFAULT_MAP_RENDERER: MapRenderer = 'repomap';

/** Render the map block the planner prompt embeds. */
export function renderMapFor(map: RepoMap, renderer: MapRenderer = DEFAULT_MAP_RENDERER): string {
  if (renderer === 'repomap') {
    // ~3k tokens is the whole budget for the map; the goal and the doctrine need room too.
    return renderRepomap(map, { maxTokens: 3000 });
  }
  return renderVerboseRepoMap(map);
}

function renderConstraints(goal: Goal): string {
  const constraints = goal.constraints.filter((entry) => entry.trim() !== '');
  if (constraints.length === 0) return '- none';
  return constraints.map((entry) => `- ${entry.trim()}`).join('\n');
}

/** Build the first-shot planner prompt: system doctrine plus the goal, constraints and repo map. */
export function buildPlanPrompt(goal: Goal, map: RepoMap, options: PlanPromptOptions = {}): PlanPrompt {
  const minTasks = options.minTasks ?? 1;
  const maxTasks = options.maxTasks ?? 12;
  const user = `# Goal
${goal.text.trim()}

# Constraints
${renderConstraints(goal)}

# Run context
Repo root: ${map.root}
Base branch: ${goal.baseBranch}
Test command: ${map.testCommand ?? 'unknown — infer from the repository map'}
Task count: between ${minTasks} and ${maxTasks} tasks. Count the capabilities and bug fixes the goal names — one task each — and do not add scaffolding, wiring, integration or documentation tasks.
Reminder: every task that can run concurrently must own disjoint paths; if two capabilities must edit the same file, merge them or serialise them with dependsOn.

# Repository map
${renderMapFor(map, options.mapRenderer ?? DEFAULT_MAP_RENDERER)}`;

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
- Concurrent tasks (no ancestor relationship through dependsOn) must have disjoint lane.owns globs. Merge the conflicting tasks into one, or move one capability into its own feature folder, or add a dependsOn edge so the later one waits.
- Do not add new tasks to dodge an error, and do not add wiring, integration, scaffolding or documentation tasks. Fix the tasks you already have.
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
