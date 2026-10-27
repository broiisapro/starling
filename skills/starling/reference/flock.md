# Flock mode — spreading the swarm across laptops

Starling runs one **hub** (the machine with the repo and the dashboard) and any number of **perches** (other
machines that lend CPU and opencode sessions). Audit and merge always happen on the hub, so the hub's repo
stays the single source of truth.

## When it is worth it

- The plan has more ready tasks than the hub can run at once (`maxParallel`, default 8).
- Tasks are long enough that a second machine pays for the setup time (seconds, not minutes).
- Both machines are on the same LAN and can reach each other over TCP.

It is not worth it for a three-minute run, for a repo with huge binaries (the bundle transfer dominates), or
when the other machine is on a different network. Starling is LAN-only: there is no relay, no cloud, no SSH.

## Start a perch

On the hub, print the join command:

```bash
starling flock
```

On the other laptop, in any directory (the perch keeps its own cache):

```bash
starling perch --hub http://192.168.1.23:7777 --code 7Q2M-9XKD
# optional: --max-sessions 5 --name "M2 Air" --port 7778
```

The perch advertises `_starling._tcp` over mDNS and registers with the hub. If multicast is blocked, the
manual `--hub/--code` join is the supported path. Back on the hub:

```bash
starling flock        # the perch should be listed as online
```

Then start (or keep) the run. The scheduler picks the online node with the most free session slots,
tie-breaking on latency and preferring the hub. Nothing else to configure.

## What travels where

1. The hub serves `git bundle` of the integration branch; the perch fetches it into a cache repo and makes a
   worktree on branch `starling/<runShort>/<taskKey>`.
2. The agent works on the perch. Its opencode events stream back to the hub over SSE.
3. On idle, the perch commits and returns a bundle of `base..branch`; the hub imports it as the task branch.
4. The hub audits and merges. A failing task is sent back to the same session for a fix.

No shared filesystem, no GitHub round-trip. The repo is copied, not mounted.

## Failure behaviour

- Heartbeats are every 3s; a perch missing for 15s is **offline**.
- A task that was `running`/`fixing` on that perch goes back to `ready` and is rescheduled (attempts
  unchanged). Work already committed on the perch but not collected is lost with the machine; the task
  restarts from the integration branch.
- Closing the lid is the normal demo: watch `node.left`, `task.migrated`, and the task finish on the hub.
- A perch that reconnects appears again; it is not automatically given back its old task.

## Security and limits

- Every hub↔perch request carries `x-flock-token`, the join code. Treat it like a password on the LAN.
- No TLS. Do not use flock mode on an untrusted network or over the public internet.
- The whole repo (including its history up to the integration branch) is sent to every perch. Do not lend a
  laptop you would not give a clone to.
- `maxSessions` is per node and set by that node (`--max-sessions` / config). The hub cannot borrow more.
- Optional: a perch with a local model can lend it for summaries/audits (`lendModels`); disabled by default.

## Flags that matter for a run

| Flag                 | Effect                                            |
| -------------------- | ------------------------------------------------- |
| `--max-parallel <n>` | global cap across all nodes, not per node         |
| `--no-dash`          | headless hub (CI, SSH session)                    |
| `--record <path>`    | JSONL log you can replay later                    |
| `--fully-open`       | local models only; the slowest, most private mode |

If a run is slower on two machines than one, check `starling flock` first: the perch may be offline, out of
slots, or on a wifi network that blocks multicast and direct TCP. Fall back to the hub and finish the run;
flock mode is an optimisation, not a requirement.
