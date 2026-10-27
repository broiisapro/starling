# Starling — Product Requirements

*Hacktoberfest Queen's 2026 Hack Day · Theme: build with open-source / open-weight AI · Builder: Moksh (solo) + a swarm of DeepSeek agents*

> A murmuration is thousands of starlings moving as one — no collisions, no leader barking orders, just simple local rules.
> **Starling does that for coding agents.** Give it one goal and a repo; it plans the work into non-overlapping *lanes*, launches a flock of open-weight coding agents in parallel git worktrees, audits every result with a local model, and merges it all back without the agents ever stepping on each other.

---

## 1. Problem

Running several coding agents at once is now normal (Claude Squad, Vibe Kanban, Emdash, Conductor, Bernstein…). But in practice:

1. **Humans do the decomposition.** Almost every tool leaves "split this goal into parallel tasks" to you. Only Bernstein plans automatically.
2. **Parallel agents collide.** Two agents edit the same file → merge conflicts → a human untangles it. Most tools handle conflicts manually.
3. **Nobody checks the work.** "Done" is whatever the agent says. Review is a diff viewer and a tired human.
4. **They're built around closed frontier models.** Open-weight models are an afterthought, and running a big fleet on paid closed models is expensive.

## 2. Solution

Starling is an **open-source, open-weight-first orchestration harness** for coding agents, built on opencode.

`starling run "Add dark mode, search, CSV export and fix the two date bugs" --repo ./my-app`

1. **Map.** Scan the repo into a compact map: files, symbols, test commands. A local model summarizes files cheaply.
2. **Plan into lanes.** DeepSeek V4.1 Flash turns the goal into a task DAG. Each task gets a **lane**: the globs it may write. The planner validates that lanes don't overlap, so parallel work is conflict-free by construction.
3. **Launch the flock.** Each ready task gets a git worktree, a branch and an opencode session running DeepSeek V4.1 Flash. Its prompt is compiled from a battle-tested methodology: goal, deliverables, out-of-scope, definition of done.
4. **Audit locally.** When an agent goes idle, Starling runs the tests, checks lane violations, and has a **local open-weight model (Qwen on the Mac)** judge the diff against the definition of done. Failures go back to the same agent with exact fix instructions, up to N times.
5. **Merge queue.** Passing branches merge in DAG order onto an integration branch. Conflicts are predicted with `git merge-tree` and handed to a resolver agent. The regression suite runs after each merge.
6. **Flock mode: the swarm spreads across machines.** Run `starling perch` on any other laptop on the network. It shows up in the Sky as a new *roost* (via mDNS discovery, or a join code when the wifi blocks multicast). Starling then schedules agents onto it by free capacity. The repo travels to the perch as a git bundle, the agent works there in its own worktree with its own opencode, and the result comes back as a bundle. Audit and merge stay on the hub. Perches with a local model can lend it to the hub for audits too. **AI belongs to everyone:** pool your friends' laptops into one open-weight swarm.
7. **Watch the sky.** A live dashboard shows the swarm as a murmuration: every task is a bird. Birds take off, fly, circle while being audited, and land on the wire (main) when merged. Panels show the DAG, agent logs, diffs, the merge queue and a cost meter: "$ spent on DeepSeek vs $0 on local".
8. **Ship as a skill.** A `SKILL.md` Agent Skill plus an opencode command let any agent hand a big goal to Starling.

Optional GitHub mode: the plan becomes issues, each task opens a PR with a structured handback, and merges close the issues.

## 3. Why it fits the challenge

| Challenge track | How Starling hits it |
|---|---|
| Build/adapt an open-source model harness | Starling *is* a harness. It drives opencode (open source) over its server/SDK API. |
| Build with an open-weight LLM | DeepSeek V4.1 Flash (MIT weights) does planning, coding and conflict resolution. Qwen 3.6 (Apache-2.0) runs **locally** for audit, summaries and PR text. |
| Create an agent skill | `skills/starling/SKILL.md` plus an opencode `/swarm` command. |
| Open source | MIT-licensed, public repo, `hacktoberfest` topic, good-first-issues seeded. |

**The meta-story for the demo:** Starling was built the way it works. About 35 DeepSeek agents across two laptops ran in parallel lanes, each worked from a compiled epic prompt, and each was audited before merge. We show the real GitHub PR graph as proof.

## 4. Users and core stories

Primary user: a developer with a medium-sized repo and a backlog of loosely-related changes.

- **S1** As a dev, I give one goal sentence and a repo path, and see a plan with lanes before anything runs (`--dry-run`).
- **S2** I approve and watch N agents work in parallel in the dashboard, in real time.
- **S3** I trust the output because every task passed tests plus a lane check plus a model audit, and I can read each verdict.
- **S4** I end with one integration branch (or a PR to main) that contains all passing work and passes the full test suite.
- **S5** I can run fully open: local models only, no API key (slower, demo-able).
- **S6** I can trigger all of this from inside opencode/Claude Code with the Starling skill.
- **S7** (demo safety) I can replay a recorded run in the dashboard with no network.
- **S8** I run `starling perch` on a second laptop and it joins the flock in seconds. New tasks get scheduled onto it, and I can see which machine each bird is on.
- **S9** If a perch disappears mid-task (lid closed), its tasks get rescheduled elsewhere and nothing is lost.

## 5. Scope

**MVP (must demo):** CLI `plan` / `run` / `replay` / `dash` / `perch`; planner with lanes and validation; worktree manager; opencode runner (real + mock); auditor (tests + lane + local LLM); merge queue onto an integration branch; SQLite store + event log; server with SSE; web dashboard (Sky with roosts, DAG, agent drawer, queue, cost meter, flock panel); **Flock mode across 2 laptops** (hub + perch, git-bundle transfer, capacity scheduler, reschedule on perch loss); the skill; the demo target repo; record/replay.

**Stretch:** mDNS zero-config discovery (the join code is the MVP fallback); perch-lent local inference for audits; GitHub issues/PR mode; conflict-resolver agent; launch-a-run form in the web UI; fully-local worker mode; Starling-on-Starling dogfood run; sound effects in the Sky.

**Non-goals:** multi-user or auth; cloud hosting; support for agent CLIs other than opencode (we design the runner interface for it, but don't build it); Windows; fine-tuning models.

## 6. Success criteria (judging day)

1. A live run on `examples/sky-todo`: 1 goal → 6–8 parallel tasks → ≥6 merged → integration-branch tests green, in under about 10 minutes.
2. The dashboard shows it all live, and the replay of a recorded run works offline.
3. At least one task visibly fails audit, gets fix instructions from the local model, and passes on retry. (We'll seed a goal likely to trigger this.)
4. The cost meter shows the local-vs-API split.
5. The skill works from inside an opencode session.
6. Flock mode: the M2 Air joins live, receives ≥2 tasks, and they merge. Killing the perch mid-run reschedules its task without manual intervention.
7. The repo is public, MIT, with a README, architecture diagram, and real swarm-built PR history.

## 7. Demo script (3 minutes)

1. **Hook (20s):** "One person built this in a day. Well, one person, two laptops and 35 agents." Show the GitHub PR graph.
2. **Run (90s):** type the goal into `starling run`. The plan with lanes appears. Birds take off from the MacBook Pro's roost. **Open the M2 Air's lid → `starling perch` → a second roost appears and birds migrate to it.** Talk over the lanes and why nothing collides, even across machines.
3. **Audit moment (30s):** a bird turns amber. Open the verdict: the local Qwen model caught a missing test. It goes back to the agent and comes back green.
4. **Land (20s):** birds land on the wire. The integration branch is green. Cost meter: "$0.0x on DeepSeek, everything else ran on this laptop."
5. **Close (20s):** it ships as an Agent Skill, it's open source, and here are the good-first-issues.

Fallback: `starling replay demo-run.jsonl` if wifi or the API dies.

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Conference wifi / API rate limits | Record a full run beforehand; replay mode; concurrency cap; backoff |
| 32 GB RAM with a local model plus many opencode sessions | One shared `opencode serve` for the product; the local model's size is configurable; benchmark in E28 |
| Merge conflicts during *our* build (20 parallel agents) | Strict lanes; contracts frozen in Wave 0; root files owned by E00 only; integrator owns `bun.lock` |
| DeepSeek agents drifting off-spec | Fully self-contained prompts, AGENTS.md rules, audit every PR before merge |
| Venue wifi blocks mDNS / peer traffic | Join code with `--hub http://ip:7777`; fallback to a phone hotspot or a direct USB-C/Thunderbolt bridge between the laptops |
| Perch dies mid-task | Heartbeats; hub reschedules the task from its last bundle or from scratch |
| Planner makes overlapping lanes | Deterministic validator plus auto-repair loop; evals in E29/E37 |
| Demo target too trivial or too big | Purpose-built `sky-todo` with seeded bugs and disjoint feature areas |
