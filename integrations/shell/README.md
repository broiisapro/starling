# Starling in your shell prompt 🐦

While a run is flying, your prompt shows **`🐦 12/30`** — twelve tasks in the air, out of thirty in the
plan. When it lands: **`🐦 ✓30`**. If something breaks: **`🐦 12/30 ✗2`**.

It works in zsh, bash (3.2, the macOS default) and fish, and it is engineered so that the prompt never
waits for the hub: the segment is a cache file read with a shell builtin, a **backgrounded** refresh talks
to `GET /api/runs` at most every two seconds, and a hub that is down costs nothing (the segment simply
disappears and the retry backs off).

```
🐦 12/30     12 tasks running/auditing/fixing/merging, 30 in the plan
🐦 12/30 ✗2  …and two have failed or hit a merge conflict
🐦 ✓30       the run landed: 30 tasks merged
st 12/30     the same thing in ASCII (STARLING_PROMPT_ASCII=1)
```

## Install

One line each, from a checkout of this repo:

```zsh
# zsh (~/.zshrc)
source /path/to/starling/integrations/shell/starling.zsh
```

```bash
# bash (~/.bashrc)
source /path/to/starling/integrations/shell/starling.bash
```

```fish
# fish (~/.config/fish/config.fish)
source /path/to/starling/integrations/shell/starling.fish
```

Put the helper on `$PATH` first, or point `STARLING_PROMPT_BIN` at it:

```sh
mkdir -p ~/.local/bin
ln -s /path/to/starling/integrations/shell/starling-prompt ~/.local/bin/starling-prompt
```

Then use `$STARLING_PROMPT` (`starling_prompt_segment` in fish) wherever you like:

```zsh
# zsh — anywhere in PROMPT or RPROMPT
PROMPT='%F{blue}%~%f ${STARLING_PROMPT} $ '
RPROMPT='${STARLING_PROMPT}'
```

```bash
# bash — PS1
PS1='\w ${STARLING_PROMPT} \$ '
```

```fish
# fish — the right prompt
function fish_right_prompt
    starling_prompt_segment
end
```

Prefer a plugin manager (oh-my-zsh, powerlevel10k, starship)? This folder intentionally does **not** ship
a theme or a starship module — the three snippets above are the whole integration, and `starling-prompt`
prints one line, so it drops into any `command`-style prompt segment you already have. Anything fancier
is a future epic.

## Opt-outs and knobs

| Setting | Effect |
| --- | --- |
| `STARLING_PROMPT=off` | Disables everything. Read when the snippet is sourced, so re-source after changing it. |
| `STARLING_PROMPT_ASCII=1` | `st 12/30` instead of `🐦 12/30`. |
| `NO_COLOR` (any value) | No colour; the helper stores a plain segment. |
| `STARLING_PROMPT_SERVER` | Hub base URL (default `http://127.0.0.1:7777`, then `STARLING_HUB_URL`). |
| `STARLING_PROMPT_BIN` | Path to the helper (default `starling-prompt` on `$PATH`). |
| `STARLING_PROMPT_INTERVAL` | Seconds between refreshes (default `2`; zsh/bash only — fish uses the helper's own throttle). |
| `STARLING_TOKEN` / `STARLING_FLOCK_TOKEN` | Sent as `x-flock-token`, so the segment keeps working after the server requires one. |
| `STARLING_PROMPT_CACHE_DIR` | Where the cache lives (default `${XDG_CACHE_HOME:-~/.cache}/starling`). |

Which run is shown: the newest run that is still `mapping | planning | planned | running`. When there is
none, the newest run that landed in the last ten minutes — then the segment goes quiet.

## Why it's fast

- **The prompt only reads a file.** zsh uses `$(<file)`, bash and fish use the `read` builtin; there is no
  fork, no network, no JSON parsing on the prompt path.
- **The refresh is detached.** `( starling-prompt --refresh & )` in zsh/bash and `cmd &; disown` in fish,
  so even a hung hub cannot delay the prompt.
- **It is throttled twice.** The snippets skip refreshes within 2 s (`$EPOCHSECONDS`, `$SECONDS`, or for
  fish `--interval-ms`), and the helper itself refuses to run more often than asked.
- **A dead hub is free.** On any failure the cache is emptied (the segment disappears) and retries back
  off 1 s → 2 s → 4 s … capped at 60 s, so a laptop away from home is not dialling `127.0.0.1` forever.

The cache is two files per hub, named after an 8-hex FNV-1a hash of the server URL:

```
${XDG_CACHE_HOME:-~/.cache}/starling/prompt-<hash>.txt    the rendered segment
${XDG_CACHE_HOME:-~/.cache}/starling/prompt-<hash>.json   { updatedAt, failures }
```

Writes are atomic (temp file + rename), so a reader never sees half a segment.

## Using the helper directly

```sh
starling-prompt                     # print the cached segment (no network at all)
starling-prompt --refresh           # one request to the hub, rewrite the cache, print the result
starling-prompt --refresh --ascii   # …and store the ASCII form
starling-prompt --style zsh         # store colour wrapped in %{…%} (bash uses \[…\])
starling-prompt --server http://m2-air.local:7777 --token XXXX-XXXX --refresh
starling-prompt --path              # machine-readable location of the cache file
```

`--style` and `--ascii` matter on `--refresh` (that is what gets rendered into the cache); the read path
prints whatever was cached. `NO_COLOR` always wins and stores the plain form.

## Tests

`bun test integrations/shell` — 102 tests, under a second: the format, the run picking, the cache round
trip and atomic write, refresh success/failure/backoff with a fake clock and fetch, the CLI's zero-network
read path, and the snippets (`bash -n`, `zsh -n`, `fish -n`, plus the bash snippet actually run in an
interactive shell). Each shell's syntax check skips when that shell is not installed.

## Limitations

- Unix shells only; no PowerShell/CMD.
- zsh and bash share the cache directory with fish, and the cache is keyed by hub URL, not by shell, so a
  fish tab and a zsh tab on the same hub will take turns overwriting each other's colour format. Use one
  shell per hub, or set `STARLING_PROMPT_CACHE_DIR` per shell.
- The segment shows one run. Running two hubs means one prompt segment; point it at the hub you care about.
