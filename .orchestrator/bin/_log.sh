# _log.sh: sourced by the orchestrator scripts. Mirrors everything the script prints into a log file
# that Claude can read directly, so you never have to paste terminal output into the chat.
#   Logs: ~/Code/starling-wt/_logs/commands/<script>-<YYYYmmdd-HHMMSS>.log
_LOG_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
_LOG_DIR="$(cd "$_LOG_ROOT/.." && pwd)/starling-wt/_logs/commands"
mkdir -p "$_LOG_DIR"
_LOG_FILE="$_LOG_DIR/$(basename "$0" .sh)-$(date +%Y%m%d-%H%M%S).log"
printf '### %s · %s %s\n' "$(date '+%F %T')" "$(basename "$0")" "$*" > "$_LOG_FILE"
exec > >(tee -a "$_LOG_FILE") 2>&1
trap 'printf "\n### exit %s · %s\n" "$?" "$(date "+%F %T")" >> "$_LOG_FILE"' EXIT
