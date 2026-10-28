# Read this when you are RESUMING a Wave 3 epic (written by the Orchestrator, 2026-10-27 night)

You were stopped mid-flight at 18:20 on 2026-10-27. Since then, on `origin/main`:

1. **The demo-day UI glow-up landed** (`style(web): …` commits): night-sky tokens in `apps/web/src/index.css`, star field, glass panels, glowing birds, top-bar counters, glass queue columns, amber join card. If you own web code (`apps/web/**`), **keep that visual language**: when a rebase conflicts in styling, take main's tokens/classes and re-apply your behaviour on top. Never revert the glow-up.
2. **`starling run` gives perches a LAN hub URL** (`b493778`), and the demo hub serves `apps/web/dist` (`apps/server/src/dev.ts`).
3. **18 Wave 3a epics merged** (tags `epic-NN-complete`): 102 perch-hardening, 103 auditor-r2, 107 planner-r2, 109 prompts-r2, 113 web-report, 115 web-lanes, 118 web-settings, 119 web-tour, 120 web-palette, 121 web-toasts, 122 web-compare, 124 web-scrubber, 126 web-leaderboard, 150 ci-r2, 151 packaging, 152 installer, 153 devcontainer, 167 shell-prompt. Their public APIs are now on main: build on them instead of duplicating (L33 additive-only still holds). Security probes they flipped to `test(` stay green.

Rules that matter more now:
- **Never kill, signal or "clean up" a process you did not start yourself** (other agents' `opencode` servers and test runs look like orphans; they are not).
- **Quota is finite.** Don't loop on a failing command; after two identical failures, write it in the handback and move on.
- Full suites only through `bash .orchestrator/bin/heavy.sh …` (L35). About 25 agents run at once.
- Your lane, L32–L39 and the Definition of done in your prompt are unchanged. Finish with the epic doc, the handback and the PR.
