# Epic 61 — Onboarding: init, doctor, first-run magic

## Goal

Make the first five minutes of Starling good: `starling doctor` should tell a judge or a contributor
exactly what is wrong with their machine and how to fix it, and `starling init` should write a
config that actually runs on that machine — with no API key, no local model and no guessing.

Both commands existed from Epic 22 but only checked the obvious things (`git --version`,
`opencode --version`, a reachable Ollama) and `init` wrote a config whose model refs did **not**
match Wave 2's `opencode` LLM profile. This epic closes those gaps and carries over Epic 40's
`init` profile default.

## How it works

### `starling doctor` — thirteen checks, each with a one-line fix

| # | check | ok when | not ok |
|---|---|---|---|
| 1 | `bun` | ≥ 1.3 | fail + `bun upgrade` |
| 2 | `git` | ≥ 2.38 | fail + `brew upgrade git` |
| 3 | `opencode` | on `PATH` | fail + install link |
| 4 | `opencode server` | a fresh `opencode serve` answers `GET /api/info` | fail + "run it by hand" |
| 5 | `deepseek` | ≥ 1 DeepSeek V4.1 Flash id in `opencode models` | fail + `opencode auth login` |
| 6 | `deepseek key` | `DEEPSEEK_API_KEY` set | **warn** (optional) |
| 7 | `gh` | `gh auth status` = 0 | **warn** (only `--github` needs it) |
| 8 | `config` | `loadConfig` parses (or no file → defaults) | fail + "fix the YAML / `init --force`" |
| 9 | `ollama` | reachable; recommended models pulled if a bench exists | warn |
| 10 | `ram` | ≥ 2 GB available | warn + `maxParallel: 1` |
| 11 | `disk` | ≥ 5 GB free in `cwd` | warn |
| 12 | `network` | a LAN IPv4 and `server.port`/`perch.port` bindable | warn + `lsof -nP -iTCP:7777` |
| 13 | `ulimit` | ≥ 1024 open files | warn + `ulimit -n 10240` |

Every non-ok check carries a `hint`; the renderer prints it as `fix: …` on its own line. The report
ends with `maxParallel N suggested` and the rule of thumb behind it.

`starling doctor --json` prints one object on stdout (no banner, no colour):

```json
{ "ok": true, "host": { "platform": "darwin", "arch": "arm64", "bun": "1.4.4" },
  "counts": { "ok": 12, "warn": 1, "fail": 0 }, "suggestedMaxParallel": 3,
  "checks": [ { "name": "bun", "status": "ok", "detail": "1.4.4 (needs ≥ 1.3)" }, … ] }
```

Exit code is 1 when any check fails, so `doctor` doubles as a CI preflight.

### The opencode-server probe (the interesting one)

`opencode --version` only proves a binary exists. The failure that actually bites is a CLI that
cannot boot its server: an unreadable auth store, a corrupt global config, a missing
`opencode-go` login. So the probe:

1. reserves a free loopback port (`Bun.serve({port: 0})`, read `.port`, close);
2. spawns `opencode serve --port <p> --hostname 127.0.0.1` with a throwaway
   `OPENCODE_SERVER_PASSWORD` merged into the child's environment;
3. reads stdout until `server listening on <url>` (10 s budget);
4. calls `GET <url>/api/info` with HTTP Basic (`opencode:<password>`) and expects a 2xx;
5. SIGTERMs the child (SIGKILL after 1.5 s), always, in a `finally`.

**`--standalone` is not passed.** On the installed opencode 2.1.2 `serve` is already a private
standalone server and `--standalone` is a *root* flag the subcommand rejects (`docs/epic-15-runner.md`
has the captured CLI output). The deliverable's wording predates that finding; the behaviour it asks
for — a real start/stop with no prompts — is what the probe does.

### `starling init` — a config for *this* machine

Detection order (documented in `detectProfile`), first hit wins:

1. **`opencode`** — `opencode models` lists any `…deepseek…v4.1…flash…` id. Whatever the provider
   prefix (`opencode-go/…`, `opencode/…`, `deepseek/…`), opencode is already authenticated, so
   Starling needs no key. The exact id is written into the config, so the generated file uses the
   model the user is logged in to.
2. **`deepseek`** — `DEEPSEEK_API_KEY` is set.
3. **`local`** — the always-works fallback (Ollama).

On a TTY it then asks three questions, each with the detected answer as the default: profile,
`maxParallel`, flock on/off. `--yes` (or any non-TTY stdin — CI, a pipe) skips them; `--dry-run`
prints the file and writes nothing; `--force` is required to overwrite.

The written file is ordinary YAML for `loadConfig`, with a comment on every field, a
`Model profile:` block explaining the profile, and a `Hardware:` block (cores, available RAM,
resulting agent count). `maxParallel` **and** `flock.hubMaxSessions` come from the same
`suggestMaxParallel` the doctor uses, so the two commands never disagree. `--max-parallel`,
`--profile`, `--no-flock` and `--force` override anything.

The `opencode` profile writes `provider: opencode` + `model: <providerID>/<modelID>` for **all six
roles**, which is exactly what `applyProfile(config, 'opencode')` in `@starling/llm` produces — so
`STARLING_LLM_PROFILE=opencode` changes nothing about a generated file. Verified on this machine:
all six roles resolve through the opencode client and split to
`{providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash'}`.

Finally it prints the four next steps (`doctor`, `plan`, `run`, `dash`).

## Key decisions & reasoning

- **Split pure parsers from side effects (`doctor-probes.ts`).** `doctor.ts` was heading past 500
  lines and every check mixed "run a command" with "understand the output". The new module has no
  imports from `doctor.ts` (one-way dependency), and both files are individually testable. This is
  the only new source file in the lane; its test file is new too.
- **macOS available RAM is `vm_stat`, not `os.freemem()`.** `freemem()` counts only "Pages free",
  which on a healthy 32 GB Mac is routinely under 1 GB — the first real run suggested
  `maxParallel: 1`. Summing free + inactive + speculative pages is the standard approximation of
  what a new process can get; it reported ~7–9 GB on the same machine. `init` and `doctor` share
  `measureAvailableMemGb`, so both print the same number.
- **Missing `gh` (or an unauthenticated `gh`) is a warning, not a failure.** `starling run` works
  without GitHub; only `--github` needs it. A judge with no GitHub token should still see a green
  doctor. Same reasoning for `DEEPSEEK_API_KEY` and Ollama.
- **The opencode-server check is a *failure*, not a warning.** Without a bootable server nothing in
  Starling can run an agent, so it must block.
- **Port probing binds loopback.** `0.0.0.0` would catch a squatter on a LAN address too, but it can
  make macOS pop an "accept incoming connections?" firewall dialog on a first run — the opposite of
  onboarding. Loopback covers Starling's own server/perch, which is the realistic conflict.
- **Hardware suggestion formula:** `min(floor(availableGb / 2), cores - 1, 8)`, at least 1.
  Rationale: an opencode worker peaks around 2 GB RSS (server session + tool subprocesses), the hub
  keeps one core, and 8 matches the default `flock.hubMaxSessions` in ARCHITECTURE §5. Exported as
  `suggestMaxParallel` + `PARALLELISM_RULE` so later epics (perch sizing, `--max-parallel` advice)
  reuse the same rule instead of inventing another.
- **`--standalone` is deliberately absent** (see above). Documented rather than silently ignored.
- **`init` selects the model id, not just the profile.** Hard-coding `opencode-go/deepseek-v4.1-flash`
  would break the moment a user is logged in to `deepseek/…` through opencode; writing the detected
  id makes the file correct by construction.
- **The opencode profile routes *every* role through opencode.** ARCHITECTURE's default table keeps
  the auditor on local Qwen, but a freshly initialised machine may have no Ollama model pulled
  (here: none of the recommended ones). All-opencode is the only profile that works out of the box
  with zero extra setup, and it is what `applyProfile` already does.

## Interfaces for future epics

Everything below is exported from `apps/cli/src/…`; the package root re-exports what Epic 22 listed.

```ts
// src/doctor.ts
export type DoctorStatus = 'ok' | 'fail' | 'warn';
export interface DoctorCheck { name: string; status: DoctorStatus; detail: string; hint?: string }
export interface DoctorResult {
  checks: DoctorCheck[]; ok: boolean; okCount: number; failCount: number; warnCount: number;
  suggestedMaxParallel?: number;          // NEW (optional, so old fixtures still typecheck)
}
export interface DoctorHost { platform: string; arch: string; bun: string | null }  // hostIdentity() now carries bun
export interface DoctorDeps {
  execFn: DoctorExec; cwd?: string; configPath?: string;
  loadConfigFn?: (path?: string, cwd?: string) => StarlingConfig;
  env?: Record<string, string | undefined>;
  freeMemGb?: () => number; totalMemGb?: () => number; cpuCores?: () => number;
  fetchFn?: typeof fetch; spawnFn?: DoctorSpawn; freePort?: () => number;
  portFree?: (port: number) => Promise<boolean>;
  networkInterfacesFn?: () => NetworkInterfaces;
  readFileFn?: (path: string) => string | undefined; rootDir?: string;
  now?: () => number; bunVersion?: string | null; platform?: string; arch?: string;
  serverTimeoutMs?: number; serverProbe?: boolean;
}
export async function runDoctor(deps: DoctorDeps): Promise<DoctorResult>;
export function suggestMaxParallel(input: { cpuCores: number; freeMemGb: number }): number;
export const AGENT_MEMORY_GB: 2, MAX_SUGGESTED_PARALLEL: 8, PARALLELISM_RULE: string;
export function doctorJson(result: DoctorResult, host: DoctorHost): string;

// src/doctor-probes.ts  (no imports from doctor.ts)
export interface DoctorProc { stdout; stderr; exited; kill(signal?) }
export type DoctorSpawn = (cmd: string[], opts: { cwd: string; env?: Record<string,string|undefined> }) => DoctorProc;
export const defaultDoctorSpawn: DoctorSpawn;
export function parseFlashModelIds(stdout: string): string[];
export function parseLanAddress(ifaces: NetworkInterfaces): string | undefined;
export function parseDfAvailableGb(stdout: string): number | undefined;
export function parseOpenFiles(stdout: string): number | undefined;
export function parseVmStatAvailableGb(stdout: string): number | undefined;
export function parseRecommendation(text: string, profile: 'mbp'|'air'): RecommendationPicks | undefined;
export function parseOllamaModelNames(body: unknown): string[];
export function hasOllamaModel(installed: string[], wanted: string): boolean;
export function profileForRam(totalGb: number): 'mbp' | 'air';
export async function measureAvailableMemGb(o: { execFn?; cwd: string; platform?; freeMemGb? }): Promise<number>;
export function freeLoopbackPort(): number;
export async function defaultPortFree(port: number): Promise<boolean>;

// src/init.ts
export type ModelProfile = 'opencode' | 'deepseek' | 'local';
export const CONFIG_FILE, OPENCODE_MODEL, DEEPSEEK_MODEL, LOCAL_MODEL;
export interface HardwareInfo { cpuCores: number; freeMemGb: number; totalMemGb: number; suggestedMaxParallel: number }
export async function detectHardware(probes?: HardwareProbes): Promise<HardwareInfo>;   // was sync in Epic 22
export interface DetectedProfile { profile: ModelProfile; opencodeModel?: string; source: 'opencode'|'deepseek-key'|'fallback' }
export async function detectProfile(o: { execFn: DoctorExec; env?; cwd }): Promise<DetectedProfile>;  // NEW, superset
export async function detectModelProfile(o: { … }): Promise<ModelProfile>;               // unchanged behaviour
export interface InitOptions {
  cwd: string; force?: boolean; profile?: ModelProfile | 'auto';
  maxParallel?: number; flockEnabled?: boolean; dryRun?: boolean;
  execFn: DoctorExec; env?; hardware?: HardwareInfo; detected?: DetectedProfile;
}
export interface InitResult {
  path: string; profile: ModelProfile; maxParallel: number; flockEnabled: boolean;
  overwrote: boolean; written: boolean; yaml: string;
}
export async function initConfig(options: InitOptions): Promise<InitResult>;
export function renderConfigYaml(profile: ModelProfile, options?: ConfigRenderOptions): string;

// src/commands/{doctor,init}.ts — third argument is a test-only injection point
export async function doctorCommand(options, context, overrides?: DoctorCommandOverrides): Promise<number>;
export async function initCommand(options, context, overrides?: InitCommandOverrides): Promise<number>;
```

CLI surface: `starling doctor [--json]`, `starling init [--yes] [--dry-run] [--force]
[--profile auto|opencode|deepseek|local] [--max-parallel N] [--no-flock]`.

**For Epic 42 (perch/flock) and Epic 51 (`--fully-open`)**: use `suggestMaxParallel` and
`measureAvailableMemGb` rather than re-deriving a number; the `perch.maxSessions` comment in the
generated config is the natural place to explain a borrowed-machine budget.

**For Epic 40 (real compose)**: a generated config now names the provider `opencode` and stores
`providerID/modelID` in `models.*.model`. `compose-real` must keep honouring
`STARLING_LLM_PROFILE` / `applyProfile` — the two are equivalent by construction.

## Deviations from plan

- **`--standalone` is not used** for the server probe (rejected by opencode 2.1.2; `serve` is already
  a private standalone server).
- **`gh` auth is a warning**, not a failure (see decisions). The old doctor failed the whole run when
  `gh` was absent.
- **The `deepseek` check now lists every matching id, not just the first line** and summarises the
  tail as `(+N more)` so the detail does not get truncated at 100 columns.
- **`init`'s interactive layer lives in `commands/init.ts`**, not `init.ts`, so the config writer
  stays a pure function of (profile, hardware, choices) and every prompt is injected in tests.
- **`render/doctor.ts` prints `fix:`** where it used to print `hint:` (a better word for a command
  you can paste), and prints the `maxParallel` suggestion line. Snapshot regenerated.
- **Two files outside the literal lane list** were touched, both listed under FIX REQUESTS in the
  handback: `apps/cli/src/program.ts` (the `--json`/`--yes`/`--dry-run`/`--max-parallel`/`--no-flock`
  flags cannot be registered anywhere else; the DoD requires them) and its test
  `apps/cli/src/program.test.ts` (a flag change without a parse test would be untested).
- **One new source file** (`doctor-probes.ts`) and its test were added inside the doctor feature
  directory rather than growing `doctor.ts` past 500 lines.

## Known limitations / deferred

- `tools/local-models/results/recommendation.json` does not exist on this machine (Epic 28 never ran
  a real benchmark), so the `ollama` check reports `no local benchmark yet` here. The reader and its
  two profiles are tested with a fixture; it will start verifying recommended models the moment a
  benchmark writes the file.
- The doctor run costs ~0.5–1.5 s extra for the server probe (a real process start). There is no
  `--fast` flag yet; `--json` still probes, because a report without the server check would be
  misleading. A `--no-server-probe` dependency switch exists for tests only.
- The interactive prompt is plain `readline` (no arrow-key selection, no preview of the file).
  Three questions felt like the right budget; anything more belongs to a TUI.
- The suggestion is a heuristic, not a measurement: it knows nothing about which models the workers
  will run (`--fully-open` with a 20 GB model needs far more RAM per agent than an API worker).
  `doctor` says so in the rule-of-thumb line.
- `network` checks the config's ports (7777/7778 by default) on loopback only; a process bound to a
  specific LAN address is not detected (see the firewall decision).
- `init` does not verify that the *chosen* profile actually works (it detects, it does not run an
  agent). `starling doctor` is the verification step, and `init` says so in its next steps.
