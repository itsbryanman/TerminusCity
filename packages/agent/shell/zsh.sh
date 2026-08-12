# Terminus City shell integration. Raw preexec text is sanitized in this
# producer and is never sent as a CLI argument, log record, relay payload, or
# browser value.
typeset -g __terminus_city_started_at __terminus_city_command __terminus_city_subcommand __terminus_city_pair_id
function __terminus_city_sanitize() {
  local raw="$1" first second base
  first="${raw%% *}"; second="${${raw#* }%% *}"; base="${first:t}"
  __terminus_city_command=other; __terminus_city_subcommand=''
  [[ -z "$first" || "$first" == *=* || "$first" == */* || "$first" == *[\;\|\&\<\>\`\$\(\)\{\}\[\]\*\?\!~]* ]] && return
  case "$base" in
    git) __terminus_city_command=git; [[ "$second" == (status|log|diff|add|commit|push|pull|checkout|switch|merge|rebase|branch|fetch) ]] && __terminus_city_subcommand="$second" ;;
    (npm|pnpm|yarn|bun)) __terminus_city_command="$base"; [[ "$second" == (test|run|build|install) ]] && __terminus_city_subcommand="$second" ;;
    (test|vitest|jest|pytest|go|cargo|export|env|printenv|set|pass|gpg|ssh|scp|rsync|curl|wget|mysql|psql|redis-cli|kubectl|aws|gcloud|az|docker|podman|ls|cd|cat|grep|find|make|node|python|python3|pip|ruby|java|code|vim|nvim|nano|tmux|htop|top|df|du|ps|kill|mkdir|rm|mv|cp|touch|chmod|chown|tar|unzip|sed|awk|jq|man|which|echo|clear|history|sudo|apt|dnf|pacman|brew|systemctl|journalctl)) __terminus_city_command="$base" ;;
  esac
}
function __terminus_city_preexec() { __terminus_city_started_at=$EPOCHREALTIME; __terminus_city_sanitize "$1"; __terminus_city_pair_id="$RANDOM$RANDOM-$EPOCHREALTIME"; [[ "${TERMINUS_CITY_TRACK_STARTED:-}" == 1 && "$__terminus_city_command" != terminus ]] && terminus emit-started "$__terminus_city_command" "$__terminus_city_subcommand" "$__terminus_city_pair_id" >/dev/null 2>&1 & }
function __terminus_city_precmd() { local code=$?; [[ -n "$__terminus_city_command" && "$__terminus_city_command" != terminus ]] && terminus emit "$__terminus_city_command" "$__terminus_city_subcommand" "$code" 0 "$__terminus_city_pair_id" >/dev/null 2>&1 & }
autoload -Uz add-zsh-hook
add-zsh-hook preexec __terminus_city_preexec
add-zsh-hook precmd __terminus_city_precmd
