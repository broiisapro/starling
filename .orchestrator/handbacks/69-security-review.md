## Epic 69 Handback — Security & safety review

**Status:** Complete (includes Fix 1). Branch `epic/69-security-review` @ `236c57d`.

**Fix 1 (probes promoted after the owner fixes landed):**

- `tools/security/replay-confinement.test.ts`: removed `.failing` from the three confinement probes ("recording outside", "symlink outside", "absolute non-recording"); the forged-recording impact test now asserts the **fixed** behaviour (403 from Epic 41's allow-list, and no `node.joined` for the attacker id in the store) and carries a comment describing what it used to demonstrate. The unauthenticated-replay probe stays `.failing` (SEC-01).
- `tools/security/exec-argv.test.ts`: allow-list is now `apps/cli/src/doctor.ts` (constant `'ulimit -n'`, Epic 61), `packages/auditor/src/commands.ts` (config) and `packages/merger/src/suite.ts` (config; moved out of `merge.ts` by Epic 45 — verified at both call sites: `merge.ts` uses `opts.testCommand` from the `Merger` port, `resolver.ts` uses `ctx.testCommand ?? ctx.prompt.testCommand`).
- `tools/security/support.ts`: `startProbeServer` accepts `repoRoot`, so the replay allow-list base is pinned to the repo root instead of the runner's cwd (compiles before and after Epic 41's `ServerDeps` change).
- `docs/epic-69-security-review.md` + the findings table below: SEC-04 marked **FIXED by Epic 41**, SEC-11's site list updated, counts corrected (26 `test.failing`, was 30).

**Delivered:**

- **Threat model** in `docs/epic-69-security-review.md`: assets (hub repo, machine, join code, opencode server, recordings, perches), actors (LAN peer, malicious repo, misbehaving agent, malicious perch/hub), entry points and the five trust boundaries we actually test, plus the risks we deliberately accept (no TLS/L18, running a repo's tests, cloud prompts/L29, open join endpoint, token = full control).
- **13 probe suites / 78 tests** in `tools/security/` (no network, no models, no opencode; `Bun.serve({port:0})` on loopback or throwaway git repos):
  - `token.test.ts` — missing/empty/wrong token 401 on every guarded route, check-before-parse, case-insensitive acceptance, constant-time comparison.
  - `cors.test.ts` — strange origin gets no `ACAO`/credentials, `localhost:5173` works and may send `x-flock-token`.
  - `bundle-ref.test.ts` — `?ref=` option-shaped/traversal refs, shell-marker absence, bundle writes confined to `bundleDir`, repo-path leakage in errors.
  - `replay-confinement.test.ts` — `/api/replay` with absolute paths, `../`, symlinks, plus forged `node.joined` event injection. **Promoted in Fix 1**: the three confinement probes and the forged-recording impact test assert Epic 41's 403 allow-list as regression tests; only the auth probe is still `test.failing`.
  - `body-size.test.ts` — 1 MiB goal/url/path/prompt on hub + perch, incl. chunked bodies with no `content-length`.
  - `sse-flood.test.ts` — stalled-vs-healthy reader isolation, unsubscribe on close, concurrent-stream cap.
  - `perch-tasks.test.ts` — hostile `branch`/`fromRef` at the perch boundary; `repo.kind:'local'` refusal; real `LocalNode` + `Workspace` proof that traversal branch names cannot escape `worktreeRoot` and option-shaped refs cannot execute.
  - `node-impersonation.test.ts` — registering/heartbeating as the reserved `hub` id.
  - `secrets.test.ts` — join code absent from event logs, request logs, perch lifecycle logs and error bodies; documents the open join route; mDNS TXT disclosure.
  - `unauth-routes.test.ts` — run start/list, node list, all-events stream and cancel without a token.
  - `auditor-lane.test.ts` — lane check catches `../`, absolute and sibling paths but not `src/../…` traversal.
  - `exec-argv.test.ts` — static scan: no `shell:true`, `Bun.$`, `child_process`, `execSync`; every `sh -c`/`bash -c` site is config- or constant-derived (three now: auditor `commands.ts`, merger `suite.ts`, CLI doctor's `ulimit -n`); git never invoked as a shell string.
  - `static-confinement.test.ts` — symlinked file/dir escape from the served web build.
- **26 expected-failure probes** (`test.failing`): green today because the defect exists; they turn red when the owning epic fixes it, which is the prompt to promote them. Convention documented in `tools/security/README.md`. (30 at delivery; four replay probes were promoted in Fix 1 after Epic 41 landed the allow-list.)
- **11 findings** with severity, owner and exact fix (table below).
- **Shared harness** `tools/security/support.ts`: temp dirs, one-commit repo factory, real `FlockHub` whose `fetch` refuses to leave the process, stub `ExecutionNode`, SSE reader, engine that records starts.

**Findings table** (severity · component · probe · owner · fix):

| ID | Sev | Component | Probe | Owner | Fix |
| --- | --- | --- | --- | --- | --- |
| SEC-01 | High | `apps/server` routes (`0.0.0.0`) | `unauth-routes.test.ts`, `replay-confinement.test.ts` | apps/server (Epic 21 follow-up; no Wave 2 lane owns it) | Bind `127.0.0.1` by default + `--lan` opt-in; token middleware on `/api/*` except `/api/health`, `/api/flock/join`; clients send `x-flock-token`. |
| SEC-02 | High | `packages/flock/src/hub.ts` identity | `node-impersonation.test.ts` | Epic 42 | Reject `info.id === 'hub'` / any stored `kind:'local'` in `register` (409); don't let a heartbeat rewrite a local node's stats. |
| SEC-03 | Med | `FlockHub.bundle` + `/api/flock/bundle` | `bundle-ref.test.ts` | Epic 42 (+ route check in apps/server) | Validate `ref` (`^[A-Za-z0-9._/-]{1,200}$`, no leading `-`, no `..`, `@{`, `:`, whitespace) → 400; never echo git stderr/repo path. |
| SEC-04 | Med → **FIXED** | `apps/server` `/api/replay` | `replay-confinement.test.ts` | apps/server / **Epic 41 (landed)** | Fixed: `resolveReplayPath` resolves + `realpath`s the path and requires it under the repo's `fixtures/` or `.starling/`, else 403; probes promoted to regression tests. Auth remains SEC-01. |
| SEC-05 | Med | `parseJsonBody` (hub), `readJson` (perch) | `body-size.test.ts` | apps/server + Epic 42 | Cap `content-length` and streamed bytes (~256 KiB) → 413 `PAYLOAD_TOO_LARGE`. |
| SEC-06 | Med | `apps/server/src/sse.ts` | `sse-flood.test.ts` | apps/server | Cap concurrent streams (e.g. 32) → 429/503; optionally drop a client past a queued-bytes threshold. |
| SEC-07 | Med | `packages/perch/src/perch-daemon.ts` mDNS | `secrets.test.ts` | Epic 42 / Epic 31 | Advertise the join code only with explicit `--mdns-code` (default off), or use a separate discovery secret. |
| SEC-08 | Low | `packages/auditor/src/lane.ts` + core `normalizeGlobPath` | `auditor-lane.test.ts` | Epic 44 | `posix.normalize` each path; reject absolute / leading `../` / remaining `..` before globbing. |
| SEC-09 | Low | `apps/server/src/static.ts` | `static-confinement.test.ts` | apps/server | `realpath` candidate and root before reading; 404 on escape. |
| SEC-10 | Low | `packages/perch` `POST /perch/tasks` | `perch-tasks.test.ts` | Epic 42 | Validate `branch`/`fromRef`/`runId`/`taskKey` at the route → 400 `invalid-body`. |
| SEC-11 | Info | auditor/merger/CLI `sh -c`/`bash -c` test commands | `exec-argv.test.ts` | Epic 44 / Epic 17 (policy) | Accepted risk: repo-controlled test commands execute by design; document + optional `--no-tests`/sandbox. Site list updated in Fix 1: merger moved to `suite.ts` (Epic 45), CLI doctor's constant `ulimit -n` (Epic 61). |

**Key design decisions:**

- **Probe the real component, not a fake.** Defaults (`0.0.0.0`, CORS, body parsing, SSE) are the bug surface, so every probe binds a real loopback listener; only out-of-process pieces are injected (hub `fetch`, perch `ExecutionNode`, mDNS advertiser).
- **`test.failing` instead of `skip`.** Green today, red when fixed; no rot, no "known bug" branches. Cost: a parallel fix makes our suite red at integration — that is the intended tripwire.
- **Relative imports into each package's `src/index.ts`.** `tools/` is not a bun workspace, so no `@starling/*` links exist there; this keeps the "public entry only" rule without a root-config change.
- **No fixes in other lanes.** Every finding is a `FIX REQUEST` with file, line and probe. Nothing outside `tools/security/**`, `docs/epic-69-*` and this handback was modified.
- **Severity by blast radius.** The two High findings end in user-level code execution; Medium means LAN credential/DoS/data leak; Low needs a hostile perch or a symlink in build output.

**Verification (exact commands + results):**

- `bun install` — `Checked 162 installs across 221 packages (no changes) [41.00ms]` (clean worktree, no deps added).
- `bun run test` (root, final run on this branch) — packages half: `1437 pass, 4 skip, 0 fail — Ran 1441 tests across 175 files. [36.28s]`; web half: `426 pass, 0 fail — Ran 426 tests across 39 files. [3.48s]`.
  - Two earlier root runs on the loaded machine (23 agents) flaked on **pre-existing, timing-sensitive tests outside this lane**, never on `tools/security`: `packages/llm/src/router.test.ts:261 "times out a slow provider"` and `apps/web/src/features/sky/sim.test.ts:516 "360 birds × 600 steps in under 250 ms"`. Both pass in isolation (`bun test packages/llm/src/router.test.ts` → 19 pass; `cd apps/web && bun test src/features/sky/sim.test.ts` → 21 pass) and the final full run was green. Flagged, not modified (AGENTS §4).
- `bun test tools/security` — at delivery: `78 pass, 0 fail; 160 expect() calls; 13 files`. After Fix 1 on this branch alone: `73 pass, 5 fail` — the five are the promoted probes whose fix (Epic 41) and shell-site move (Epic 45) live on other branches; see the trial merge below. 26 of the 78 are `test.failing` (was 30).
- **Fix 1 trial merge** (the Orchestrator's all-17 integration is the real gate; this reproduces the relevant slice): `git merge --no-commit --no-ff origin/epic/41-live-dashboard origin/epic/45-resolver origin/epic/61-onboarding` → clean octopus, then `bun test tools/security` → **`78 pass, 0 fail; 162 expect() calls; Ran 78 tests across 13 files. [1.41s]`**, `bunx tsc --noEmit -p tools/security/tsconfig.json` → 0 errors, `bunx biome check tools/security` → `Checked 16 files. No fixes applied.` Then `git merge --abort`; the branch is unchanged apart from the Fix 1 commits.
- `bun run check` — clean at delivery: `biome check .` → `Checked 721 files in 869ms. No fixes applied.` + `tsc --noEmit` for every workspace exited 0. After Fix 1: `bunx biome check tools/security docs/epic-69-security-review.md .orchestrator/handbacks/69-security-review.md` → `Checked 17 files. No fixes applied.`, and `bunx tsc --noEmit -p tools/security/tsconfig.json` → 0 errors (the root `typecheck` loops `packages/*`/`apps/*`, so `tools/` is always checked explicitly).
- `bun run test` (root, on this branch after Fix 1) — packages half: `1432 pass, 4 skip, 5 fail — Ran 1441 tests across 175 files. [15.18s]`; **the 5 failures are exactly the promoted probes** (3 replay confinement + forged-recording impact + `exec-argv`'s site list), red only because Epic 41/45 are not on this branch. The web half does not run when the packages half fails; it was green at delivery and is untouched by Fix 1.
- Manual repro sessions against real components confirmed each finding before it became a probe (git refs, static symlink, mDNS payload, registry replacement, authority leakage). No live model/opencode/GitHub calls were made.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none. (Core was read only; every probe uses existing contracts and the public package entries.)

**FIX REQUESTS:**

1. **SEC-01 — `apps/server` (owner: apps/server / Epic 21 follow-up).** `startServer` (`apps/server/src/app.ts:133-140`) defaults `hostname: '0.0.0.0'` and no route outside `/api/flock/*` checks a token (`mountRuns`, `mountEvents`, `mountReplay` in `app.ts:83-92`). LAN peer → `POST /api/runs {goal, repoPath}` starts an agent with shell access (RCE-by-proxy), and `GET /api/events` streams everything. Fix: default `hostname: '127.0.0.1'`, add an explicit `--lan` / `hostname` opt-in for flock, and add one `requireFlockToken` middleware for all `/api/*` except `/api/health` and `/api/flock/join` (token in `x-flock-token`, verified via `FlockHub.verifyToken`). Teach `apps/web` and the CLI to attach the token. Probes: `tools/security/unauth-routes.test.ts`, `tools/security/replay-confinement.test.ts`.
2. **SEC-02 — `packages/flock/src/hub.ts` (owner: Epic 42).** `register` (`:143-182`) replaces any node with a matching id when the URL differs, including the hub's own `LocalNode` registered as `'hub'`; `heartbeat` (`:184-199`) calls `registry.touch` for any known id. Fix: in `register`, reject `info.id === 'hub'` and any id whose stored entry has `kind === 'local'` with `StarlingError('INVALID_ARGUMENT', …)` → the route maps it to 400/409; in `heartbeat`, ignore a touch whose stored entry is `kind: 'local'` unless it originates from the hub. Probe: `tools/security/node-impersonation.test.ts`.
3. **SEC-03 — `packages/flock/src/hub.ts` + `apps/server/src/routes/flock.ts` (owner: Epic 42).** `bundlePathFor` (`hub.ts:79-125`) spawns `git rev-parse --verify ${ref}^{commit}` and `git bundle create <tmp> ${ref}` with the request's ref, and the route (`flock.ts:105-108`) surfaces `EXEC_FAILED` messages that quote git stderr (including the absolute repo path). Fix: validate ref before spawning (length ≤ 200, `^[A-Za-z0-9._/-]+$`, reject leading `-`, any `..` segment, `@{`, `:`, whitespace) and throw `INVALID_ARGUMENT` → 400 `INVALID_QUERY`; replace the git message in the HTTP response with a generic "ref not found", logging the detail instead. Probe: `tools/security/bundle-ref.test.ts`.
4. **SEC-04 — `apps/server` replay (owner: apps/server) — ✅ FIXED by Epic 41 (merged in the trial merge).** Epic 41 added `apps/server/src/replay-paths.ts` (`resolveReplayPath`, `defaultReplayRoots`) and wired it into `mountReplay` via `deps.replayRoots`/`repoRoot`: the target is resolved and `realpath`-ed and must live under the repo's `fixtures/` or `.starling/`, otherwise 403 `FORBIDDEN`. The original request was: `loadReplayFile` calls `readFileSync(path)` on the raw body value; resolve `realpath(path)`, require it under a configured replay dir, else 403, and drop the path from the malformed-recording message. That is now the behaviour; the four probes were promoted in Fix 1. Remaining half (token) is SEC-01. Probe: `tools/security/replay-confinement.test.ts`.
5. **SEC-05 — body limits (owner: apps/server + Epic 42).** `parseJsonBody` (`apps/server/src/http.ts:52-64`) and `readJson` (`packages/perch/src/perch-app.ts:290-312`) call `c.req.json()` unconditionally. Fix: reject when `content-length` exceeds 256 KiB and count streamed bytes (read via `c.req.raw.body` reader) → 413 `PAYLOAD_TOO_LARGE` / `payload-too-large`. Probe: `tools/security/body-size.test.ts`.
6. **SEC-06 — `apps/server/src/sse.ts` (owner: apps/server).** `streamEvents` (`:46-129`) opens a stream and a bus subscription per request with no cap. Fix: keep a module-level (or deps-level) `Set` of open streams with a max (32), answer 429/503 past it, and remove on the existing `stop()`; optionally abort a stream whose queued write chain exceeds N bytes. Probe: `tools/security/sse-flood.test.ts`.
7. **SEC-07 — `packages/perch/src/perch-daemon.ts` (owner: Epic 42 / Epic 31).** `:244-253` passes `txt: { code: token, node: resolvedName }` to mDNS. Fix: advertise the code only when a new `--mdns-code` flag is set (default off), or publish a distinct discovery id and require a one-time code; update `docs/epic-31-perch.md` accordingly. Probe: `tools/security/secrets.test.ts`.
8. **SEC-08 — `packages/auditor/src/lane.ts` + `packages/core/src/glob.ts` (owner: Epic 44; core change is additive/normalisation-only, so needs Epic 40's sign-off under L30).** `checkLane` (`lane.ts:34-46`) normalises with `normalizeGlobPath` (`glob.ts:16-22`), which does not resolve `..`. Fix: `const path = posix.normalize(normalizeGlobPath(file).replace(/\\/g,'/'))` and treat any path that is absolute, starts with `../`, or still contains a `..` segment as a violation before glob matching. Probe: `tools/security/auditor-lane.test.ts`.
9. **SEC-09 — `apps/server/src/static.ts` (owner: apps/server).** `resolveStaticPath` (`:50-61`) does a lexical `isInside`, then `readFileIfPresent` (`:42-47`) follows symlinks. Fix: compare `realpathSync(candidate)` against `realpathSync(root)` (both normalised) before reading; 404 on escape. Probe: `tools/security/static-confinement.test.ts`.
10. **SEC-10 — `packages/perch/src/perch-app.ts` (owner: Epic 42).** `POST /perch/tasks` (`:92-118`) passes `branch` and `fromRef` straight to `node.startTask`. Containment holds, but the hub gets a 500 with git stderr. Fix: add a zod refinement for `branch`/`fromRef` (`^[A-Za-z0-9._/-]{1,200}$`, no `..`, no leading `-`, `fromRef` also no `@{`) and a `runId`/`taskKey` charset check; 400 `invalid-body`. Probe: `tools/security/perch-tasks.test.ts`.
11. **SEC-11 — policy, not code (owner: Epic 44 / Epic 17).** The auditor (`packages/auditor/src/commands.ts:57`) and merger (`packages/merger/src/merge.ts:36`) run repo-provided commands through `sh -c`/`bash -c`. Fix: document the accepted risk in the auditor/merger docs and add an opt-in `--no-tests` (already conceptually distinct from `testCommand: auto`) or a future sandboxed runner. `tools/security/exec-argv.test.ts` fails if any *new* shell site appears or if a request value reaches one of these two.

**Deliberately deferred / out of scope:**

- No live probes of `opencode serve`, the LLM providers or `gh` (L23/L29): they need real credentials/processes and belong to a prompt-injection/credential-scope review, not an HTTP-boundary one. Reviewed by reading (`spawn.ts` keeps the server password in the child env and never logs it; the LLM router does not log headers).
- No fuzzing/property tests for bodies, refs or paths; hand-picked hostile values only.
- No memory-size assertion for the SSE queue (heap measurements are noise with ~20 agents on the box); the cap fix makes it moot.
- No dependency/CVE audit (`bun audit`) and no web XSS/CSP review of the dashboard rendering model output.
- No TLS, identity or per-node credentials: L18 makes the join code a shared LAN secret, and this epic did not relitigate it.

**Open questions / flagged tradeoffs:**

- **SEC-01's fix is cross-cutting.** Token-on-every-route needs the web shell and CLI to carry `x-flock-token`; the cheaper demo-day mitigation is binding loopback by default. The integrator should pick one before demo day; both are one commit and both are listed in the finding.
- **`test.failing` collides with parallel fixes — expected, and it happened.** Epic 41 fixed replay confinement, so Fix 1 deleted `.failing` from the four affected probes, kept the assertions, and marked SEC-04 fixed. Epic 45 moved the merger's suite from `merge.ts` to `suite.ts` and Epic 61 added a constant `ulimit -n` shell site; `exec-argv.test.ts` now allowlists all three. **Until 41/45 merge, this branch alone is red on those five probes by design** (73 pass / 5 fail); the trial merge above is green (78/0). Do not "fix" the probes back at integration.
- **`repoRoot` in the probe harness is a cross-version bridge.** `tools/security/support.ts` passes `repoRoot` through an object assertion so it compiles both before and after Epic 41's `ServerDeps` change; once 41 is merged the field is simply part of the type and the assertion can be dropped.
- **SEC-07 (mDNS) is a product tradeoff, not just a bug.** Zero-config discovery is a headline feature; the code in TXT is how it authenticates. `--mdns-code` default-off keeps both, at the cost of typing the code once. Flagged for Epic 42/31 rather than decided here.

Closes #84
