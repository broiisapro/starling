# integrations/shell/starling.zsh — `🐦 12/30` in your prompt, for zsh.
#
#   echo 'source /path/to/starling/integrations/shell/starling.zsh' >> ~/.zshrc
#   PROMPT='%F{blue}%~%f ${STARLING_PROMPT} $ '
#
# Never blocks: the segment is read from a cache file with $(<file) — no fork, no network. A backgrounded
# `starling-prompt --refresh` updates that file at most once every $STARLING_PROMPT_INTERVAL seconds.
#
# Opt-outs (read when this file is sourced):
#   STARLING_PROMPT=off        nothing at all
#   STARLING_PROMPT_ASCII=1    `st 12/30` instead of `🐦 12/30`
#   NO_COLOR                   any value: no colour (the helper writes a plain segment)
# Other knobs: STARLING_PROMPT_SERVER, STARLING_PROMPT_BIN, STARLING_PROMPT_INTERVAL, STARLING_TOKEN.

if [[ -n ${_STARLING_PROMPT_LOADED:-} ]]; then
  return 0 2>/dev/null || exit 0
fi

# $STARLING_PROMPT is the *output* variable below, so the opt-out has to be checked before we start
# assigning to it (and before we mark the file loaded, so a re-source after `off` is harmless).
if [[ ${STARLING_PROMPT:-} == off ]]; then
  return 0 2>/dev/null || exit 0
fi
typeset -g _STARLING_PROMPT_LOADED=1

# $EPOCHSECONDS (whole seconds, no fork) — the reason the throttle costs nothing.
zmodload zsh/datetime 2>/dev/null

typeset -g STARLING_PROMPT=''
typeset -g _starling_prompt_bin=${STARLING_PROMPT_BIN:-starling-prompt}
typeset -g _starling_prompt_server=${STARLING_PROMPT_SERVER:-${STARLING_HUB_URL:-http://127.0.0.1:7777}}
typeset -g _starling_prompt_interval=${STARLING_PROMPT_INTERVAL:-2}
typeset -gi _starling_prompt_last=0
typeset -g _starling_prompt_path=''

# One fork at shell start (not per prompt) gives us the exact cache path the helper writes.
if command -v "$_starling_prompt_bin" >/dev/null 2>&1; then
  _starling_prompt_path=$("$_starling_prompt_bin" --path --server "$_starling_prompt_server" 2>/dev/null)
fi

_starling_prompt_read() {
  emulate -L zsh
  local line=''
  if [[ -n $_starling_prompt_path && -r $_starling_prompt_path ]]; then
    line=$(<"$_starling_prompt_path")
  fi
  STARLING_PROMPT=$line
}

_starling_prompt_refresh() {
  emulate -L zsh
  local now=${EPOCHSECONDS:-0}
  (( now - _starling_prompt_last < _starling_prompt_interval )) && return 0
  _starling_prompt_last=$now
  local -a args
  args=(--refresh --server "$_starling_prompt_server" --style zsh --interval-ms $((_starling_prompt_interval * 1000)))
  [[ -n ${STARLING_PROMPT_ASCII:-} ]] && args+=(--ascii)
  [[ -n ${STARLING_TOKEN:-} ]] && args+=(--token "$STARLING_TOKEN")
  # Detached subshell + background job: the prompt never waits for the hub, not even for a DNS lookup.
  ( "$_starling_prompt_bin" "${args[@]}" >/dev/null 2>&1 & )
}

_starling_prompt_precmd() {
  _starling_prompt_read
  _starling_prompt_refresh
}

# Chained, not replaced: other plugins (or you) keep their precmd hooks.
typeset -ga precmd_functions
precmd_functions+=(_starling_prompt_precmd)

# Show something on the very first prompt instead of waiting for the first refresh.
_starling_prompt_read
