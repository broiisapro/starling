SPECS = []

SPECS.append(dict(nn="27", slug="skill", title="Agent Skill + opencode integration", scope="skill",
lane="`skills/**` and `integrations/**`",
goal="""Ship Starling as an **Agent Skill** (the open `SKILL.md` format) and an **opencode command**, so any coding agent (opencode, Claude Code, others that read skills) can hand a big multi-part goal to the flock instead of grinding through it serially. This is the "create an agent skill" track of the hackathon, so make it polished.""",
deliverables="""- **Research first**: read the current Agent Skills format spec (SKILL.md frontmatter fields `name` and `description`, progressive disclosure via linked reference files, bundled `scripts/`), and how the **installed opencode version** discovers skills and custom commands. Check `opencode --help`, its docs site, and where it looks for skills and commands (project `.opencode/` vs global `~/.config/opencode/`). Record what you found in your doc with links.
- `skills/starling/SKILL.md`:
  - Frontmatter with a sharp `description` that triggers on "parallelise this", "split into tasks", "run a swarm" and multi-feature goals.
  - Body: when to use Starling (multi-part goals with separable areas) and when not (one-file fixes); the 4-step workflow (`starling plan --json` → review lanes → `starling run` → watch/report); how to write a good goal; how to read the result (integration branch, verdicts); and safety (dry-run first, budget flag).
  - Keep it under ~300 lines and move detail into `skills/starling/reference/*.md` (`goals.md`, `lanes.md`, `flock.md`, `troubleshooting.md`).
- `skills/starling/scripts/`: `plan.sh`, `run.sh`, `status.sh` and `replay-demo.sh`, thin bash-3.2 wrappers over the CLI surface in ARCHITECTURE §6. They check `starling` is on PATH (or fall back to `bunx`/`bun run starling` from a repo checkout), print machine-readable output for agents (`--json`), and exit non-zero with a clear message on failure.
- `integrations/opencode/`: a `/swarm` custom command definition in the format the installed opencode expects (the agent passes `$ARGUMENTS` as the goal; it runs plan, shows lanes, asks the user to confirm, then runs), plus `install.sh [--global|--project]`, which copies the skill and command into the right opencode directories idempotently and prints what it did. Also `integrations/claude-code/README.md` with the one-liner to install the skill for Claude Code (skills folder), so the skill isn't opencode-only.
- `skills/starling/examples/`: two worked transcripts (illustrative, clearly labelled) of an agent using the skill on sky-todo.
- Tests (bun test in `skills/` or `integrations/`): SKILL.md frontmatter parses and the description is ≤ 1024 chars with the trigger words; every relative link in the skill resolves to a file; every script passes `bash -n` and prints usage on `--help`; `install.sh --project` into a temp dir creates the expected files and is idempotent on a second run.""",
oos="CLI implementation (Epic 22; your scripts target its locked surface). Running a real swarm. Publishing to a marketplace.",
dod=["`bun test skills integrations` passes, ≥ 12 tests.",
     "Paste the output of `bash integrations/opencode/install.sh --project` run in a temp copy of sky-todo, plus a listing of the installed files."]))

SPECS.append(dict(nn="28", slug="local-bench", title="Local model benchmark harness (MBP + Air)", scope="local-models",
lane="`tools/local-models/**`",
budget="45–90 min",
carryover="""Epic 02 is merged (or about to be): `tools/local-models/` has `setup.sh`, `candidates.json`, `smoke.ts` (plus `ollama.ts`/`host.ts` if its fix kept the refactor) and real smoke results for `qwen3.8:27b-mlx`. **Critical lesson (L23):** loading a 27B model while ~20 agents run pushed this 32 GB Mac to 4% free RAM. So in this epic you build and test the benchmark **without loading any model**. The real benchmark run happens later as a deliberate step when nothing else is running.""",
goal="""Build the benchmark that decides **which local open-weight models Starling uses for auditing and summarising on each laptop** (MacBook Pro M5 Pro 32 GB; MacBook Air M2, RAM to be confirmed by `setup.sh` there). It measures accuracy on audit-style judgments as well as speed and memory, and writes a recommendation. Build it fully now, and validate it against a fake Ollama.""",
deliverables="""- `tools/local-models/cases/`: **12 audit cases** as JSON. Each has a task spec (title, DoD), a unified diff, a test-output tail and the expected verdict (`pass`) plus required mentions (e.g. must mention "test"). Use realistic sky-todo-style changes: good csv export with tests; csv export **without** tests (must fail); a lane violation (must fail); partial DoD; tests failing; a trivially good docs change; a subtle bug (off-by-one in the date fix); good but large; etc. Balanced roughly half pass, half fail.
- `tools/local-models/bench.ts`: `bun tools/local-models/bench.ts --models a,b --profile mbp|air [--cases dir] [--repeat 2] [--max-ram-gb N] [--dry-run]`.
  - For each model, run all cases through the same JSON-schema audit request that `smoke.ts` uses (reuse its client code).
  - Record per-case correctness, TTFT, total latency, tok/s and JSON validity.
  - Record the model's resident memory (via `ollama ps` sizes) and system free memory before and after.
  - **Safety rails**: refuse to start if more than 4 `opencode` processes are running, or if free memory is < `--max-ram-gb` headroom, unless `--force`. Unload each model (`keep_alive: 0`) before loading the next. Abort a model on its first OOM-ish failure.
- Output: `results/bench-<host>-<date>.json` plus a markdown table printed to stdout, and `recommend.ts`, which picks per profile the best model by accuracy, then latency, within the RAM budget, and writes `results/recommendation.json` (`{ mbp: {auditor, summarizer}, air: {auditor, summarizer} }`).
- `--dry-run` and the test suite use a **fake Ollama server** on `Bun.serve({ port: 0 })` that answers deterministically (scripted per model: one "smart" fake that gets everything right, one "lazy" fake that passes everything) so the scoring, rails and recommendation logic are fully tested.
- `tools/local-models/RUNBOOK` section in your doc: the exact steps Moksh runs later, (a) on the MBP with all agents stopped and (b) on the Air, and how long each takes.""",
oos="Actually loading/pulling models in this session (L23). Auditor package code (Epic 16). Changing Ollama settings globally.",
dod=["`bun test tools/local-models` passes, ≥ 15 tests, all against the fake server.",
     "`bun tools/local-models/bench.ts --dry-run --models fake-smart,fake-lazy --profile mbp` output pasted (the table plus the recommendation picking fake-smart)."]))

SPECS.append(dict(nn="29", slug="evals", title="Evals harness (planner + auditor)", scope="evals",
lane="`evals/**`",
goal="""Build the evals that tell us whether Starling's **planner** produces good, lane-safe decompositions and whether its **auditor** makes the right calls, measured against answer keys rather than vibes. In Wave 1 the harness runs against port implementations you're given (mocks now; the real planner and auditor in Wave 2's quality passes).""",
deliverables="""- `evals/planner/cases/`: convert every `examples/sky-todo/demo-goals/*.expected.md` into structured JSON cases (goal text, expected task count range, required feature coverage as keyword groups, expected dependency edges, files that must be in some lane, files that must **not** be touched). Add **3 more cases** on two small public-repo-shaped synthetic fixtures you generate (e.g. a tiny Express API, a tiny Python CLI) with RepoMaps written by hand.
- `evals/planner/score.ts`: `scorePlan(plan, case, repoMap) → { score: 0..1, checks: [...] }`. Checks: the validator has zero error-level issues (reimplement the overlap check with core `globsOverlap`/`lanesDisjoint`, not the planner package), task count in range, feature coverage (keyword groups matched in titles/deliverables), dependency correctness (required edges present, no spurious edges between disjoint features), lane precision (lanes cover the needed files, nothing forbidden), and DoD quality (every task has a test item).
- `evals/auditor/cases/`: 12 seeded diffs with expected verdicts. Coordinate in spirit with Epic 28 but **don't import from tools/**; write your own set focused on *decision quality* (including tricky ones: tests added but trivially asserting `true`; a lane violation in a lockfile; a docs-only task).
- `evals/auditor/score.ts`: accuracy, false-pass rate (the dangerous one), false-fail rate, and quality of fix instructions (keyword hits).
- `evals/run.ts`: `bun evals/run.ts planner|auditor --impl mock|real [--case name]`. `mock` uses core testing mocks scripted with **reference answers** (to validate the harness itself); `real` imports `@starling/planner` / `@starling/auditor` dynamically and is documented as Wave 2-only (it needs the real packages and a model). Output: a table plus `evals/results/<suite>-<date>.json`.
- Tests: scoring functions on hand-built good and bad plans/verdicts (a perfect plan scores ≥ 0.95; an overlapping plan fails the validator check; a missing feature reduces coverage); case files validate against their zod schemas; `run.ts --impl mock` end to end.""",
oos="Running real models (L23). Tuning the planner or auditor (Wave 2, Epics 44 and 48). Modifying `examples/`.",
dod=["`bun test evals` passes, ≥ 15 tests.",
     "`bun evals/run.ts planner --impl mock` and `bun evals/run.ts auditor --impl mock` outputs pasted."]))

SPECS.append(dict(nn="30", slug="flock", title="Flock core: nodes, registry, scheduler, discovery", scope="flock",
lane="`packages/flock/**`",
goal="""Build the distributed heart of Starling: **ExecutionNodes**. `LocalNode` runs agents on this machine; `RemoteNode` runs them on another laptop through the Perch API. Around them sit the **NodeRegistry**, the capacity-aware **Scheduler**, the **FlockHub** (join codes, registration, heartbeats, offline detection, repo bundles) and **mDNS discovery**. This is what makes the demo moment ("open the Air's lid, and birds migrate to it") real.""",
deliverables="""- `createLocalNode(opts: { id?: 'hub' | string; name: string; workspace: Workspace & Partial<BundleOps>; runner: AgentRunner; maxSessions: number; worktreeRoot: string; clock?: Clock; infoProvider?: () => Partial<NodeInfo> }): ExecutionNode`. `startTask` creates the worktree (local repo) or, for `{kind:'bundle'}`, downloads the bundle (`fetch` with `x-flock-token`), clones/fetches it into a cache repo under the worktree root and creates the worktree there; then `runner.start`. `collect` commits all and computes the diff; for bundle-sourced tasks it also writes a result bundle (`base..branch`). `cleanup` removes the worktree. Capacity tracking feeds `NodeInfo.activeSessions`, and events are re-emitted from the runner filtered to this node's sessions. `BundleOps` is a local type here (`createBundle`, `cloneFromBundle`, `fetchBundle`, matching Epic 14's names), injected, so tests use fakes.
- `createRemoteNode(opts: { url: string; token: string; info: NodeInfo; fetch?: typeof fetch; clock?: Clock }): ExecutionNode`: an HTTP client for the **Perch API** (ARCHITECTURE §6 table, exact paths). `onEvent` holds one SSE connection to `/perch/events` with reconnect. `collect(h, hubRepo, baseRef)` POSTs collect, then GETs the bundle and fetches it into `hubRepo` as `h.branch` (via injected `fetchBundle`), returning `TaskResult` with `bundlePath`. Every call has a timeout. Network errors map to `StarlingError('NODE_OFFLINE')`.
- `createRegistry(opts: { clock: Clock; offlineAfterMs: number }): NodeRegistry & { add(node: ExecutionNode, info: NodeInfo); remove(id, reason); touch(id, info) }`: emits `joined`/`left`/`stats`. A timer marks nodes `offline` after `offlineAfterMs` without a touch and emits `left` (reason `heartbeat-timeout`).
- `createScheduler(): Scheduler`: picks the online node with the most free slots (`maxSessions - activeSessions`), tie-breaking by lower `latencyMs`, then hub-first, then id. Returns undefined when there's no capacity. Pure.
- `createFlockHub(opts: { registry; hubUrl: string; code?: string; exec?; bundleDir: string; clock; mdns?: MdnsBrowser }): FlockHub` (mirror §8 in `src/handshake.ts`):
  - The join code is 8 chars, grouped `XXXX-XXXX`, from an unambiguous alphabet.
  - `verifyToken` uses constant-time compare.
  - `register` creates a RemoteNode and adds it.
  - `heartbeat` touches it (or re-registers on unknown id).
  - `bundle(ref)` runs `git bundle create` from the active repo into `bundleDir`, cached by ref sha.
  - mDNS: if given a browser, auto-registers discovered perches that answer `/perch/info` with the right code.
- `src/mdns.ts`: a `MdnsBrowser`/`MdnsAdvertiser` interface plus a `bonjour-service` implementation (`_starling._tcp`). Tests use a fake.
- Tests: the scheduler table (capacity, latency, tie-breaks, none available); the registry timeout with FakeClock; LocalNode with core `MockWorkspace`/`MockRunner` (+ fake bundle ops) through the full lifecycle; RemoteNode against a **fake perch** on `Bun.serve({ port: 0 })` implementing the §6 Perch API (start → SSE events → collect → bundle download → fetch called), a token-rejected case, perch death mid-task (server stops → `NODE_OFFLINE`, registry `left`); FlockHub register/heartbeat/verify/bundle with a real temp git repo for `bundle()`.""",
oos="The perch daemon/server side (Epic 31). Engine rescheduling logic (Epic 20). The web flock panel (Epic 32). Real multi-laptop testing (Wave 2, Epic 42).",
dod=["`bun test packages/flock` passes, ≥ 25 tests. No servers left running."]))

SPECS.append(dict(nn="31", slug="perch", title="Perch daemon", scope="perch",
lane="`packages/perch/**`",
goal="""Build the **perch**: what runs when someone types `starling perch` on another laptop. It exposes a local `ExecutionNode` over the Perch HTTP API, advertises itself on the LAN, registers with the hub using the join code, and keeps a heartbeat going, so the hub can schedule agents onto this machine.""",
deliverables="""- `createPerchApp(deps: { node: ExecutionNode; token: string; info: () => Promise<NodeInfo>; bus?: EventBus }): Hono`, implementing **every route in the ARCHITECTURE §6 Perch API table exactly**:
  - `x-flock-token` checked in constant time (401 otherwise); zod-validated bodies; JSON errors.
  - `POST /perch/tasks` accepts `StartTaskOptions` with `repo.kind === 'bundle'` and returns the `TaskHandle`.
  - The bundle endpoint streams the result bundle produced by `node.collect` (find it via the `TaskResult.bundlePath` you cached at collect time).
  - `/perch/events` is SSE of the node's `AgentEvent`s with a keep-alive.
- `startPerch(opts: { node: ExecutionNode; hub?: string; code?: string; port?: number /* 7778 */; name?: string; maxSessions?: number; mdns?: MdnsAdvertiser; clock?: Clock; fetch?: typeof fetch }): Promise<{ url: string; nodeId?: string; stop(): Promise<void> }>`:
  - Binds `0.0.0.0` and determines its LAN URL (first non-internal IPv4; document the choice).
  - If `hub` is given: `POST {hub}/api/flock/register` with `x-flock-token: code` and `{ url, info }`, then heartbeat every `heartbeatMs` (3 s) to `/api/flock/heartbeat`. Back off and retry if the hub is unreachable, and re-register on a 404 unknown node.
  - Advertises `_starling._tcp` over mDNS when `mdns` is given (`MdnsAdvertiser` is a local interface whose shape matches Epic 30's names, mirrored in `src/handshake.ts`, with a `bonjour-service` implementation).
  - Graceful stop: deregister if possible, abort running sessions, stop the heartbeat.
- `perchInfo(opts)`: builds `NodeInfo` from the OS (hostname/`scutil --get ComputerName` on macOS, platform, arch, CPU cores, total memory GB, `maxSessions`, active sessions from the node, `localModels` from `ollama list` **only if** `lendModels` is on and Ollama answers on `/api/tags`, without loading anything).
- **Loopback proof**: a test that starts **two perches on one machine** (ports 0, separate cache dirs, each with a `MockNode` from core testing) plus a fake hub `Bun.serve`. Both register, heartbeat, accept a task, stream events, return collect results and bundles, and one is stopped → the hub stops receiving its heartbeats.
- Tests: every route's happy path plus auth and validation errors; SSE ordering; the register/heartbeat loop with FakeClock and a fake hub (including hub-down backoff and the re-register on 404); `perchInfo` with injected OS/exec fakes.""",
oos="`LocalNode`/`RemoteNode`/registry/scheduler (Epic 30). CLI flag parsing (Epic 22). Real two-laptop testing (Wave 2, Epic 42). TLS.",
dod=["`bun test packages/perch` passes, ≥ 20 tests, including the two-perch loopback test. No ports left open."]))

SPECS.append(dict(nn="32", slug="web-flock", title="Web: flock panel", scope="flock-ui",
lane="`apps/web/src/features/flock/**` (may add a dependency line to `apps/web/package.json`, add-only; a small QR library like `qrcode` is allowed, pinned exact).",
goal="""Build the **flock panel**: the dashboard's view of every machine in the swarm and the on-ramp for new ones. It should make "anyone in the room can lend their laptop" feel one scan away. Props-only per ARCHITECTURE §8.""",
deliverables="""- `export function FlockPanel(props: FlockPanelProps)` from `features/flock/index.ts` (mirror §8 in `handshake.ts`):
  - **Roost cards**, one per node, hub first. Each shows: name, a hub/perch badge, a status dot (online/busy/offline with a pulse when busy), platform/arch/CPU cores/RAM, a **session meter** (`activeSessions / maxSessions` as segmented pips), local models as chips ("lends qwen3.8:27b"), latency, and the tasks currently on it (keys from `tasks` where `nodeId` matches, clickable chips).
  - Offline nodes are dimmed with "last seen 12s ago".
  - Cards animate in and out (respecting reduced motion).
  - A **Join card**: the join code in big monospace with a copy button, the full `command` with copy, and a **QR code** encoding the command (or the hub URL). Explainer copy: "Run this on any laptop with opencode + Starling installed to add it to the flock."
  - An empty state when only the hub exists: "Your flock is just you. Add a laptop →".
  - A compact mode (`compact?: boolean` prop, an addition beyond §8 that you document) for narrow regions: a single row of mini roosts.
- A local fallback status palette until C1. `Playground.tsx` driven from the fixture JSONL: show the Air joining mid-run and dropping, by deriving nodes from `node.*` events with a tiny local helper.
- Tests: card per node in hub-first order; the session meter; tasks-per-node chips; the offline styling; copy buttons (mock clipboard); the QR renders an `<svg>`/`<canvas>` for the command; the empty state; compact mode.""",
oos="Global store/wiring (Epic 23/C1). Registering nodes (backend). The Sky's roost visuals (Epic 24).",
dod=["`bun test apps/web/src/features/flock` passes, ≥ 12 tests."]))
