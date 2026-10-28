# integrations/shell/starling.bash — `🐦 12/30` in your prompt, for bash (3.2, the macOS default).
#
#   echo 'source /path/to/starling/integrations/shell/starling.bash' >> ~/.bashrc
#   PS1='\w ${STARLING_PROMPT} \$ '
#
# Never blocks: the segment comes from a cache file read with the `read` builtin (no fork, no network).
# A detached `starling-prompt --refresh` runs at most once every $STARLING_PROMPT_INTERVAL seconds,
# measured with $SECONDS so the check is pure arithmetic.
#
# Opt-outs (read when this file is sourced):
#   STARLING_PROMPT=off        nothing at all
#   STARLING_PROMPT_ASCII=1    `st 12/30` instead of `🐦 12/30`
#   NO_COLOR                   any value: no colour
# Other knobs: STARLING_PROMPT_SERVER, STARLING_PROMPT_BIN, STARLING_PROMPT_INTERVAL, STARLING_TOKEN.

if [ -n "${_STARLING_PROMPT_LOADED:-}" ]; then
  return 0 2>/dev/null || exit 0
fi

# $STARLING_PROMPT is the output variable below, so the opt-out must be read before the first
# assignment (and before the loaded flag, so a re-source after `off` stays quiet).
if [ "${STARLING_PROMPT:-}" = off ]; then
  return 0 2>/dev/null || exit 0
fi
_STARLING_PROMPT_LOADED=1

STARLING_PROMPT=''
_starling_prompt_bin="${STARLING_PROMPT_BIN:-starling-prompt}"
_starling_prompt_server="${STARLING_PROMPT_SERVER:-${STARLING_HUB_URL:-http://127.0.0.1:7777}}"
_starling_prompt_interval="${STARLING_PROMPT_INTERVAL:-2}"
# Start "overdue" so the first prompt refreshes instead of waiting $STARLING_PROMPT_INTERVAL seconds.
_starling_prompt_last=$(( ${SECONDS:-0} - _starling_prompt_interval ))
_starling_prompt_path=''

if command -v "$_starling_prompt_bin" >/dev/null 2>&1; then
  _starling_prompt_path="$("$_starling_prompt_bin" --path --server "$_starling_prompt_server" 2>/dev/null)"
fi

_starling_prompt_read() {
  # Clear first: `read` returns non-zero for an empty file *and* for a final line with no newline, so
  # the exit status must not decide whether a valid segment survives.
  STARLING_PROMPT=''
  if [ -n "$_starling_prompt_path" ] && [ -r "$_starling_prompt_path" ]; then
    IFS= read -r STARLING_PROMPT <"$_starling_prompt_path" || true
  fi
}

_starling_prompt_refresh() {
  local now="${SECONDS:-0}"
  if [ $(( now - _starling_prompt_last )) -lt "$_starling_prompt_interval" ]; then
    return 0
  fi
  _starling_prompt_last=$now
  local -a args
  args=(--refresh --server "$_starling_prompt_server" --style bash --interval-ms $(( _starling_prompt_interval * 1000 )) )
  [ -n "${STARLING_PROMPT_ASCII:-}" ] && args+=(--ascii)
  [ -n "${STARLING_TOKEN:-}" ] && args+=(--token "$STARLING_TOKEN")
  # `( cmd & )` detaches the job: no job control messages, no wait, output discarded.
  ( "$_starling_prompt_bin" "${args[@]}" >/dev/null 2>&1 & )
}

_starling_prompt_cmd() {
  _starling_prompt_read
  _starling_prompt_refresh
}

# bash 3.2 has no PROMPT_COMMAND array, so chain by hand and keep whatever was there.
PROMPT_COMMAND="_starling_prompt_cmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"

_starling_prompt_read
