# integrations/shell/starling.fish — `🐦 12/30` on the right side of your prompt, for fish.
#
#   echo 'source /path/to/starling/integrations/shell/starling.fish' >> ~/.config/fish/config.fish
#   function fish_right_prompt; starling_prompt_segment; end
#
# Never blocks: starling_prompt_segment reads the cache with the `read` builtin and prints it. Refreshes
# are detached (`&` + disown) and throttled to one every 2 s by `--interval-ms`, because fish has no
# clock builtin — the helper's own state file is the timer, so the prompt line costs nothing.
#
# Opt-outs:
#   STARLING_PROMPT=off        nothing at all
#   STARLING_PROMPT_ASCII=1    `st 12/30` instead of `🐦 12/30`
#   NO_COLOR                   any value: no colour
# Other knobs: STARLING_PROMPT_SERVER, STARLING_PROMPT_BIN, STARLING_TOKEN.

if set -q _STARLING_PROMPT_LOADED
    return
end
set -g _STARLING_PROMPT_LOADED 1

if set -q STARLING_PROMPT; and test "$STARLING_PROMPT" = off
    return
end

set -g _starling_prompt_bin starling-prompt
if set -q STARLING_PROMPT_BIN
    set -g _starling_prompt_bin $STARLING_PROMPT_BIN
end

set -g _starling_prompt_server http://127.0.0.1:7777
if set -q STARLING_PROMPT_SERVER
    set -g _starling_prompt_server $STARLING_PROMPT_SERVER
else if set -q STARLING_HUB_URL
    set -g _starling_prompt_server $STARLING_HUB_URL
end

set -g _starling_prompt_path ''
if type -q $_starling_prompt_bin
    set -g _starling_prompt_path (command $_starling_prompt_bin --path --server $_starling_prompt_server 2>/dev/null)
end

function starling_prompt_segment --description 'Starling run progress (🐦 12/30) for fish_right_prompt'
    if set -q STARLING_PROMPT; and test "$STARLING_PROMPT" = off
        return 0
    end
    if not test -r "$_starling_prompt_path"
        return 0
    end
    set -l line ''
    read -l line <"$_starling_prompt_path"
    string join '' -- $line
end

function _starling_prompt_refresh --on-event fish_prompt --description 'Refresh the Starling prompt cache in the background'
    if test -z "$_starling_prompt_path"
        return 0
    end
    set -l args --refresh --server $_starling_prompt_server --style plain --interval-ms 2000
    if set -q STARLING_PROMPT_ASCII; and test "$STARLING_PROMPT_ASCII" != 0
        set -a args --ascii
    end
    if set -q STARLING_TOKEN
        set -a args --token $STARLING_TOKEN
    end
    command $_starling_prompt_bin $args >/dev/null 2>&1 &
    disown 2>/dev/null
end
