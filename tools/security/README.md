# Starling security probes (Epic 69)

Attack probes for the parts of Starling that face the network or other people's code: the hub server,
the perch API, the flock bundle channel, replay, the event stream, the auditor's lane check and the
`exec` boundary.

Each file is a normal `bun test` suite. Probes that **find** a defect are written as
`test.failing(...)`: the suite is green today (the defect is confirmed), and turns red the moment the
owning epic fixes it, which is the prompt to delete the `.failing` and keep the assertion as a
regression test. Probes that assert a property Starling already holds are plain `test(...)`.

```sh
bun test tools/security            # ~5 s, no network, no models, no opencode
bun run test                       # the repo-wide gate (runs this directory too)
```

Everything binds `Bun.serve({ port: 0 })` on `127.0.0.1` or builds a throwaway git repo under the OS
temp dir. Nothing here talks to the LAN, GitHub, DeepSeek, Ollama or opencode.

| File | Attacks | Findings reported in |
| --- | --- | --- |
| `token.test.ts` | flock token: absent, wrong, empty, timing | `docs/epic-69-security-review.md` |
| `cors.test.ts` | cross-origin reads and preflight from an untrusted origin | same |
| `bundle-ref.test.ts` | `?ref=` option injection, traversal, repo-path leakage, disk writes | same |
| `replay-confinement.test.ts` | `/api/replay` with `../`, absolute paths and symlinks | same |
| `body-size.test.ts` | unbounded request bodies on the hub and the perch | same |
| `sse-flood.test.ts` | connection floods and stalled readers on `/api/events` | same |
| `perch-tasks.test.ts` | `POST /perch/tasks` with a hostile `branch`/`fromRef`/`repo` | same |
| `node-impersonation.test.ts` | registering or heartbeating as the reserved `hub` node | same |
| `secrets.test.ts` | join codes in logs, errors and recorded JSONL | same |
| `auditor-lane.test.ts` | lane check against `..`-shaped and absolute paths | same |
| `exec-argv.test.ts` | shell-string execution across every package | same |
| `static-confinement.test.ts` | symlink escape from the served web build | same |

Severity and the fix owner for every finding are in the epic doc's findings table; the fixes
themselves are `FIX REQUEST`s in `.orchestrator/handbacks/69-security-review.md`. This directory only
proves problems — it never patches another lane.
