# Epic 69 — Security & safety review

## Goal

Starling hands an LLM a shell, opens an HTTP server on `0.0.0.0`, ships repos between laptops and
reads files on request. Before demo day we needed to know **what an attacker on the same Wi-Fi, a
malicious repo, or a misbehaving agent can actually do**, with a probe that proves each answer, and a
precise fix handed to the epic that owns it.

This epic writes no production code. Its deliverable is:

1. a threat model (below),
2. 13 probe suites / 78 tests in `tools/security/`, 26 of which are `test.failing` because they
   **find** an issue (`bun run test` stays green; a fix turns the probe red and that is the prompt to
   promote it to a regression test). Four replay probes were promoted this way in Fix 1 once Epic 41
   landed the allow-list (see *Fix 1* below).
3. 11 findings with severity, owner and an exact fix (`FIX REQUEST`s in the handback).

## Threat model

### Assets

| Asset | Why it matters |
| --- | --- |
| The hub repo (`/Users/…/project`) | The user's actual work, including uncommitted files and `.env` secrets. |
| The machine | `opencode` agents run shell commands as the logged-in user. Anything that can start a run can run code. |
| The flock join code | The only credential between hub and perch (ARCHITECTURE L18). Anyone holding it can run agents on every perch. |
| The opencode server | Local HTTP API with a per-process password; an agent session is arbitrary code execution. |
| Recorded runs (`*.jsonl`, SQLite) | Goals, prompts, diffs, file names — and anything an agent printed. |
| Other perches | Their repos, their CPUs, their Ollama models. |

### Actors

| Actor | Capability assumed |
| --- | --- |
| **LAN peer** | Can reach `hub:7777` and `perch:7778`, can read mDNS advertisements, may or may not know the join code. Assumed hostile. |
| **Malicious repo** | Controls file contents, `package.json` scripts, test/lint commands, and every line of source an agent reads. |
| **Misbehaving / compromised agent** | Runs as the user inside a worktree; may try to write outside its lane, read `~/.ssh`, or `curl` data out. |
| **Malicious perch** | Has the join code (a legitimate laptop that turned hostile, or one that read it off mDNS). Returns arbitrary `TaskResult.changedFiles`, commit ids and bundles to the hub. |
| **Malicious hub** | A perch trusts the hub to name branches, refs and prompts. A hostile hub is the perch's threat model for `POST /perch/tasks`. |

### Entry points and trust boundaries

```
LAN peer ──► hub :7777 ──► engine ──► opencode ──► shell / worktrees / repo
              │  /api/runs, /api/replay, /api/events (no token today)      ▲
              │  /api/flock/* (join code)                                   │ agent-written code
              ├──► git (bundle, worktree, merge)                            │
              └──► mDNS / bundle URLs ──► perch :7778 ──► agent + git ──────┘
                                    (join code in x-flock-token, and in TXT today)
```

Trust boundaries that the probes exercise:

1. **LAN → hub HTTP.** Only `/api/flock/*` is authenticated; everything else, including run creation
   and replay, is open. The server binds `0.0.0.0` by design.
2. **Request body → git argv.** `?ref=` reaches `git rev-parse` / `git bundle create`, `branch` and
   `fromRef` reach `git worktree add`. No shell is involved, but git options are still arguments.
3. **Request body → filesystem.** `/api/replay` takes a path; static hosting maps URL paths to files.
4. **Hub → perch HTTP.** The perch validates the token, then trusts `branch`, `fromRef`, `runId` and
   `taskKey`.
5. **Agent → worktree boundary.** Enforced only by the auditor's lane globs, applied to a
   `changedFiles` array that a remote perch supplies.

### What we deliberately accept

- **No TLS and no per-node identity** (ARCHITECTURE L18): the join code is a shared secret on a
  LAN-only channel. Fixing this is a Wave 3 product decision, not a demo-day bug.
- **Running a repo's tests executes that repo's code.** `testCommand`/`lintCommand` come from the repo
  map and run through `bash -c` in the auditor and the merger. That is inherent to "run the tests";
  the mitigation is isolation (container, no network, throwaway user), not quoting.
- **Prompts and diffs go to the configured model.** With the Wave 2 `opencode` profile that means
  cloud inference (L29). A `.env` that a worker puts in a diff is sent too. Starling's answer today is
  "do not run it on a repo whose secrets you would not paste into a chat window".
- **`GET /api/flock/join` is unauthenticated.** It must be: a perch reads it before it has a token, and
  the dashboard renders it as a QR code. It is asserted in `secrets.test.ts` so the tradeoff stays
  visible. The *unintended* disclosure is mDNS (SEC-07).
- **Any token holder can run anything on any node.** The join code is a full-control credential by
  design; `POST /perch/tasks` is not a limited API.

## Findings

Every finding was reproduced against a real component on `127.0.0.1:0`. "Probe" is the file in
`tools/security/`; a `test.failing` probe is currently green *because* the defect exists.

| ID | Severity | Component | Finding | Probe | Owner | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | **High** | `apps/server` routes | Every hub route except `/api/flock/*` is unauthenticated while the server binds `0.0.0.0`. A LAN peer can `POST /api/runs` with any `repoPath` and any goal (an agent with shell access → code execution as the user), read every run, enumerate perches, stream all events, and replay a file. | `unauth-routes.test.ts`, `replay-confinement.test.ts` | apps/server (Epic 21 follow-up; no Wave 2 lane owns it) | Bind `127.0.0.1` by default, `--lan` to opt in; add one `requireFlockToken` middleware for all `/api/*` except `/api/health` and `/api/flock/join`; teach the web shell + CLI to send `x-flock-token`. |
| SEC-02 | **High** | `packages/flock` `hub.ts` | Node identity is not reserved. `POST /api/flock/register` with `info.id: "hub"` replaces the hub's own `LocalNode` in the registry with a `RemoteNode` pointing at the attacker. A heartbeat for `nodeId: "hub"` rewrites the hub's stats (`maxSessions: 1000`, name, url). | `node-impersonation.test.ts` | Epic 42 (`packages/flock`) | In `register`, reject `info.id === 'hub'` or any id whose stored entry is `kind: 'local'` (409); in `heartbeat`, ignore/reject a touch when the stored entry is local unless it is the hub itself. |
| SEC-03 | Medium | `packages/flock` `bundle()` + `apps/server` `/api/flock/bundle` | `?ref=` is passed unvalidated to `git rev-parse --verify <ref>^{commit}` and `git bundle create`. `--all`, `--not`, `--upload-pack=…`, `@{-1}`, `..` and newlines reach git as arguments; a failure is a 500 whose message quotes git's stderr — including the hub repo's absolute path (`HEAD:../../etc/passwd` → `'…' is outside repository at '/Users/…'`). A token holder can also force bundling of arbitrary revisions and grow the bundle cache without bound. | `bundle-ref.test.ts` | Epic 42 (`packages/flock`); route-level check in `apps/server` | Validate `ref` before spawning git: `^[A-Za-z0-9._/-]{1,200}$`, reject a leading `-`, `..`, `@{`, `:` and whitespace; answer 400 `INVALID_QUERY`. Never echo git stderr in an HTTP error (log it, return "ref not found"). Optionally allowlist the active run's branches. |
| SEC-04 | Medium → **FIXED** | `apps/server` `/api/replay` | **Fixed by Epic 41.** Originally replay accepted any path the process could read: absolute paths, `../`, and symlinks. A valid recording outside the run directory was replayed (202); a non-recording answered `Invalid JSON on line 1 of <path>`, an existence oracle. Published events are attacker-chosen, so a LAN peer could inject a fake `node.joined` into the dashboard. | `replay-confinement.test.ts` (promoted) | apps/server / Epic 41 | **Landed:** `resolveReplayPath` (`apps/server/src/replay-paths.ts`) resolves the request path, `realpath`s an existing target and requires it under the active repo's `fixtures/` or `.starling/`, else 403 `FORBIDDEN`; the forged-recording probe asserts nothing is published. Still open: authentication (SEC-01). |
| SEC-05 | Medium | `apps/server` `parseJsonBody`, `packages/perch` `readJson` | No maximum body size. A 1 MiB goal, registration URL, replay path, prompt or fixer prompt is accepted and parsed into memory; the hub then keeps it in events. One request can exhaust a demo laptop's memory. | `body-size.test.ts` | apps/server + Epic 42 (`packages/perch`) | Check `content-length` when present and cap streamed bytes while reading (e.g. 256 KiB for both apps); answer 413 `PAYLOAD_TOO_LARGE`. |
| SEC-06 | Medium | `apps/server` `sse.ts` | No cap on concurrent SSE streams. Each connection adds a bus subscriber and an unbounded per-connection write chain; a client that never reads buffers every frame. 80 simultaneous `/api/events` connections are accepted. A stalled reader does *not* starve healthy clients and a closed tab does unsubscribe (both proven), so the gap is the missing cap, not a leak. | `sse-flood.test.ts` | apps/server | Track open streams and answer 429/503 past a documented cap (32 is plenty for a dashboard); optionally drop a client whose queued bytes exceed a threshold. Combine with SEC-01 auth so the cap is per-token. |
| SEC-07 | Medium | `packages/perch` `perch-daemon.ts` | The join code is published in the mDNS TXT record (`txt: { code: token, node }`). Any device on the Wi-Fi that browses `_starling._tcp` learns the credential and can then start tasks, read diffs and command the perch. This defeats the token for the zero-config path. | `secrets.test.ts` | Epic 42 (`packages/perch`) / Epic 31 | Advertise the code only with an explicit `--mdns-code` opt-in (default off); or advertise a separate discovery secret and require a one-time code entry for control traffic. Document the tradeoff in the perch README. |
| SEC-08 | Low | `packages/auditor` `lane.ts` / `packages/core` `normalizeGlobPath` | The lane check normalises `./`, `\` and duplicate slashes but not `..`. `checkLane(['src/../secrets.env'], ['src/**'])` returns `ok: true`, so a traversal-shaped path (only reachable from a hostile perch's `TaskResult.changedFiles`, since git never emits `..`) is reported as inside the lane. Relative escapes and absolute paths *are* caught. | `auditor-lane.test.ts` | Epic 44 (`packages/auditor`) | Canonicalise each path with `node:path.posix.normalize`, reject any path that starts `../`, is absolute, or still contains a `..` segment, before glob matching. |
| SEC-09 | Low | `apps/server` `static.ts` | Static hosting is a lexical prefix check; `readFileIfPresent` follows symlinks. A symlink inside `apps/web/dist` serves any file the hub can read (`/leak.txt` → 200 with the target's bytes). | `static-confinement.test.ts` | apps/server | `realpath` the resolved candidate and compare it against the `realpath` of the web root before reading; reject with 404 when it escapes. |
| SEC-10 | Low | `packages/perch` `POST /perch/tasks` | The perch forward `branch` and `fromRef` verbatim to `LocalNode.startTask`. Containment holds — `Workspace` sanitises the worktree path, git rejects the invalid branch, `exec` is argv-only, and the option-shaped `fromRef` does not execute — but the hub gets a 500 with git's stderr instead of a 400. | `perch-tasks.test.ts` | Epic 42 (`packages/perch`) | Validate `branch` (`^[A-Za-z0-9._/-]{1,200}$`, no `..`, no leading `-`) and `fromRef` (same plus no `@{`), and the `runId`/`taskKey` pair, in the route; answer 400 `invalid-body`. |
| SEC-11 | Info | `packages/auditor`, `packages/merger`, `apps/cli` | The repo's own `testCommand`/`lintCommand` run through `bash -c` in the worktree and on the integration branch. A malicious repo controls those scripts. The allowed `sh -c`/`bash -c` set is now three sites: the auditor (`commands.ts`), the merger's suite runner (`suite.ts`, moved out of `merge.ts` by Epic 45), and the CLI doctor's constant `ulimit -n` (Epic 61) — everything else is argv-only. | `exec-argv.test.ts` | Epic 44 / Epic 17 (policy) | Not a code fix: document it as an accepted risk and offer `--no-tests` / a sandboxed runner in a later wave. The static probe keeps any new shell site visible. |

### Fix 1 — probes promoted after the owner fixes landed

The Orchestrator merged all 17 Wave 2 branches in a test copy. Epic 41 landed the replay allow-list
(SEC-04) and Epic 45 moved the merger's suite (SEC-11's second shell site), so the affected probes were
updated in place:

- `replay-confinement.test.ts`: "recording outside", "symlink outside" and "absolute non-recording"
  lost `.failing` and now assert 403; the forged-recording impact test asserts the *fixed* behaviour
  (403, and no `node.joined` reaches the store) with a comment describing what it used to prove. The
  unauthenticated-replay probe is still `.failing` (SEC-01).
- `exec-argv.test.ts`: the allow-list is now `apps/cli/src/doctor.ts` (`'ulimit -n'`, a constant),
  `packages/auditor/src/commands.ts` (config) and `packages/merger/src/suite.ts` (config, Epic 45).
  `packages/merger/src/merge.ts` no longer has a site.
- `support.ts` gained `repoRoot`, so the replay probes pin the allow-list base to the repo root instead
  of whatever cwd the test runner inherited.

Consequence: **this branch alone has 5 expected red probes** (`bun test tools/security` → 73 pass / 5
fail) until Epic 41 and Epic 45 merge; the assertions encode the merged behaviour, not the branch's.
Verified by tentatively merging them (see the handback): 78 pass / 0 fail. This is the tripwire
working as designed, not a regression.

### Findings that turned out to be non-issues (kept as probes)

- **Flock token gate**: 401 for missing/empty/wrong tokens on every guarded route, before body
  parsing; case-insensitive acceptance of the typed form; constant-time comparison
  (`token.test.ts`).
- **CORS**: a strange origin gets no `access-control-allow-origin`, no credentials; `localhost:5173`
  works and may send `x-flock-token` (`cors.test.ts`).
- **Secrets in recordings**: the join code never appears in the event log, request logs or error
  bodies (`secrets.test.ts`); only mDNS leaks it.
- **Workspace containment**: hostile branch names cannot create a directory outside `worktreeRoot`,
  and option-shaped refs do not execute (`perch-tasks.test.ts`).
- **Perch repo policy**: `repo.kind: 'local'` is refused, so a hub cannot ask a perch to read its disk.
- **SSE lifecycle**: a closed connection unsubscribes; a stalled reader does not starve a healthy one.

## How it works

Each probe suite:

1. builds the **real** component — `startServer` from `@starling/server` on
   `Bun.serve({ port: 0, hostname: '127.0.0.1' })`, `createPerchApp` on its own ephemeral listener,
   `createFlockHub` over a throwaway git repo, or `createLocalNode` + `createWorkspace` over a temp
   repo;
2. attacks it with `fetch` / a crafted `changedFiles` array / a crafted JSONL file;
3. asserts either the property Starling should hold (`test`) or the defect it currently has
   (`test.failing`).

`tools/security/support.ts` holds the shared harness: temp dirs, a one-commit repo, a `FlockHub` with
a fetch that refuses to leave the process, a stub `ExecutionNode`, an SSE reader and an engine that
records starts. All imports go through each package's public `src/index.ts`.

Run just this lane with `bun test tools/security` (≈3 s, no network). The root `bun run test` picks it
up automatically because it already includes `tools`.

### Why `test.failing` instead of `skip`

`test.failing` asserts "this test body fails". It is green today (the bug is real) and turns **red**
when the owning epic fixes the bug — which is exactly the signal we want at integration time: promote
the probe to a normal test, keep it forever. `skip` would hide the probe, and an `if (knownBug) return`
would rot. 26 probes are in this state; they map onto the findings above (a couple of findings need
more than one probe). Four fewer than at first delivery, because Epic 41 fixed SEC-04 and those probes
were promoted (see *Fix 1*).

## Key decisions & reasoning

- **Probe the real component, not a fake.** The fake-hub route tests in `apps/server/src` already
  prove the happy path. Security questions are about defaults (`0.0.0.0`, `cors` origins, body
  parsing), so every probe binds a real listener. Only the pieces that would leave the machine are
  injected: `fetch` on the flock hub, the `ExecutionNode` behind the perch, the mDNS advertiser.
- **No network, no models, no opencode.** L23/L29 make live calls expensive and racy. The opencode
  server, the LLM router and GitHub are reviewed by reading + static probes (`exec-argv.test.ts`),
  and listed as deferred below.
- **One probe per claim.** A finding without a probe is a suspicion; every row in the table names the
  file that proves it. Conversely, four "suspicions" that were wrong (token timing, CORS, workspace
  escape, SSE cleanup) became regression probes rather than being deleted — the next agent to touch
  those files gets a warning.
- **Relative imports into `src/index.ts`.** `tools/` is not a bun workspace (`workspaces` is
  `packages/*`, `apps/*`), so it has no `@starling/*` links. Importing the public entry by relative
  path keeps the "no sibling internals" rule while letting the probes live outside the workspace
  graph. If `tools/security` is ever promoted to a workspace package, only the import specifiers
  change.
- **`test.failing` over a documented skip.** See above; the cost is that a parallel fix makes our
  suite red, which is the right failure mode for a security tripwire, and is called out in the
  handback so the integrator knows to demote rather than "fix the test".
- **Severity by blast radius, not by ease.** SEC-01 and SEC-02 are High because they end in code
  execution with the user's credentials; the rest are Medium (credential/DoS/data leak on the LAN) or
  Low (needs a hostile perch, or a symlink in the build output).
- **Do not fix other lanes.** The value of this epic is an unpatchable audit trail: fixes go to the
  owning epics as `FIX REQUEST`s with file, line and test. The one exception was not needed.

## Interfaces for future epics

- **Run the security suite** with `bun test tools/security`. It is part of the root `bun run test`.
- **Promote a fixed finding**: delete `.failing` from the probe, run the file, commit. The assertions
  are already written as the *desired* behaviour, so no new test is needed.
- **Add a probe**: import the real component or add a helper to `support.ts`; keep the
  no-real-network rule, and make sure a *defect* probe is `test.failing`.
- **Before shipping a new route**: it inherits SEC-01. If it reads a path, copy nothing from
  `/api/replay` (SEC-04); if it spawns a process, use `core.exec` with an argv array (enforced by
  `exec-argv.test.ts`); if it accepts a body, cap it (SEC-05).
- **For the web shell / CLI (Epic 41/40)**: if SEC-01 is fixed with a token, every client call needs
  `x-flock-token`; `/api/flock/join` stays open so the token can be obtained on the LAN.

## Deviations from plan

- **Added `unauth-routes.test.ts`** beyond the listed probes. The assignment's entry-point list
  mentioned the server but not "is anything authenticated at all"; the answer (nothing but
  `/api/flock/*`) is the highest-impact finding, so it deserved a probe.
- **The mDNS probe uses a fake advertiser.** Real mDNS on a shared Wi-Fi is not a unit test (it
  broadcasts, can collide with the demo, and is flaky in CI). `startPerch` receives an injected
  `MdnsAdvertiser`, which is the same seam the perch's own tests use; the payload asserted is exactly
  what `createBonjourAdvertiser` would publish.
- **The timing probe is structural, not statistical.** A wall-clock comparison of "differs first"
  vs "differs last" still varied 5× between the two call sites (the JIT compiles them differently)
  on a laptop running ~20 agents, so a ratio assertion is a flake generator. The probe instead
  asserts the property that makes the comparison constant-time — every character folded into one
  accumulator, exactly one `return` — plus a functional check that a difference at every position
  is detected, and the length-independent SHA-256 path in `tokensMatch`.
- **`exec-argv.test.ts` allowlists three `sh -c`/`bash -c` sites.** Banning the pattern outright
  would fail on the auditor/merger (repo test commands) and the CLI doctor's constant `ulimit -n`. The
  probe instead asserts the allowed set and that no expression is request-derived. A new site fails the
  probe on purpose; Epic 45 moving the merger's suite to `suite.ts` and Epic 61 adding the doctor probe
  were each a one-line update, which is the maintenance cost we accepted.
- **The hub's `GET /api/nodes` and `GET /api/flock/join` are documented, not patched.** Both are
  architectural (dashboard + QR onboarding), so they are findings for the integrator, not probes.

## Known limitations / deferred

- **No opencode, LLM or GitHub probes.** `packages/runner` spawns `opencode serve` with the password in
  the child's environment; `packages/llm` sends prompts to the configured provider; `packages/github`
  shells out to `gh`. Each needs a live system (L29) and a separate threat model (prompt injection,
  token scope). Reviewed by reading only. `spawn.ts` does not log the password, and the LLM router
  never logs headers — verified by inspection, not by probe.
- **No memory measurement for the SSE queue.** SEC-06's cap is asserted; the *size* of the unread
  queue is not measured, because heap assertions under 20 parallel agents are noise. The fix (a cap)
  makes the measurement moot.
- **No fuzzing or property tests.** Bodies, refs and paths are probed with hand-picked hostile values,
  not a fuzzer. `bun test --randomize` would help; a fuzzer belongs in a dedicated tool.
- **Prompt injection is out of scope.** A malicious repo's `README.md` telling the agent to `curl` its
  `.env` is a model-behaviour problem, not an HTTP-boundary one. The lane check + auditor are the only
  controls and both are advisory against a determined agent.
- **No dependency/CVE audit, no web XSS review.** `bun audit` and a dashboard review are separate
  work; the web app renders model output, which deserves its own CSP pass.
- **Findings are point-in-time.** 23 agents are editing neighbouring files this wave. Any
  `test.failing` that turns red at rebase means the owner fixed it — demote the probe, do not
  re-open the finding. Fix 1 is that rule in practice: Epic 41's replay allow-list turned four probes
  red in the integration copy, so they were promoted and SEC-04 closed.
