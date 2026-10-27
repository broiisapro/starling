# Starling for Claude Code

Starling ships as a standard [Agent Skill](https://agentskills.io), so Claude Code can use it without an
opencode install. Claude Code reads `SKILL.md` from:

- personal: `~/.claude/skills/<name>/SKILL.md`
- project: `.claude/skills/<name>/SKILL.md` (commit it to share with the team)

## One-liner (personal)

From a Starling checkout:

```bash
integrations/opencode/install.sh --dir ~/.claude
```

That copies `skills/starling/` to `~/.claude/skills/starling/` and the optional `/swarm` command to
`~/.claude/commands/swarm.md`. Claude Code merges commands into skills, so `/swarm <goal>` appears alongside
the automatic `starling` skill. Re-running is idempotent: identical files are left alone.

If you only want the skill and not the command:

```bash
mkdir -p ~/.claude/skills && rsync -a --delete /path/to/starling/skills/starling/ ~/.claude/skills/starling/
```

## Project install

```bash
integrations/opencode/install.sh --dir .claude
```

Commit `.claude/skills/starling/` (and `.claude/commands/swarm.md` if you want the command) so everyone on
the repo gets it. Do not commit `starling.config.yaml` secrets; the skill only needs the CLI and git.

## Use it

- **Automatic:** ask for something matching the description — "parallelise this: dark mode, search and CSV
  export", "split this into tasks", "run a swarm on the docs".
- **Explicit:** `/starling`, or `/swarm <goal>` if you installed the command.

Inside a Claude Code session the agent follows the same workflow: plan JSON → lane review → confirmation →
run → report. The scripts (`scripts/plan.sh`, `run.sh`, `status.sh`) must be executable and `starling` must be
on `PATH` (or `STARLING_BIN` set).

## What is shared, what is not

The `SKILL.md`, references, scripts and examples are identical across agents. Only discovery differs:

| Agent       | Personal skills                                   | Project skills                         | Command file                                          |
| ----------- | ------------------------------------------------- | -------------------------------------- | ----------------------------------------------------- |
| Claude Code | `~/.claude/skills/`                               | `.claude/skills/`                      | `~/.claude/commands/` or `.claude/commands/`          |
| opencode v2 | `~/.config/opencode/skills/`, `~/.claude/skills/` | `.opencode/skills/`, `.claude/skills/` | `~/.config/opencode/commands/`, `.opencode/commands/` |

opencode also reads `.claude/skills/`, so a project install in `.claude/` serves both agents. See
[the opencode integration](../opencode/README.md) and `docs/epic-27-skill.md` for the research.
