# Starling for opencode

This folder installs two things into an opencode config directory:

| Destination         | What it is                                                          |
| ------------------- | ------------------------------------------------------------------- |
| `skills/starling/`  | the Agent Skill (`SKILL.md`, `reference/`, `scripts/`, `examples/`) |
| `commands/swarm.md` | the `/swarm <goal>` custom command                                  |

## Install

```bash
integrations/opencode/install.sh --project   # this repo: .opencode/
integrations/opencode/install.sh --global    # every project: ~/.config/opencode/
```

`--project` is the default. `--dir <path>` targets a specific config directory, `--dry-run` shows what would
change. Re-running is safe: identical files are reported as unchanged.

Then reload opencode (`opencode reload`) or restart it.

## Use it

In the TUI:

```text
/swarm Add dark mode, live search, CSV export and fix the date bugs
```

The command plans the goal, shows the lanes, asks you to confirm, then launches the run and reports by
exception. Without arguments it asks for a goal.

Installed locations for opencode v2.1.2 (verified against `opencode debug paths`):

- project skills: `.opencode/skills/<name>/SKILL.md`
- project commands: `.opencode/commands/<name>.md` (the legacy singular `command/` is also read)
- global skills: `~/.config/opencode/skills/<name>/SKILL.md`
- global commands: `~/.config/opencode/commands/<name>.md`

See `docs/epic-27-skill.md` for the research links and the v1-vs-v2 differences.

## Unix only (for now)

The scripts are bash 3.2 (macOS default) and are not supported on Windows without WSL. The skill itself is
plain Markdown and works anywhere.
