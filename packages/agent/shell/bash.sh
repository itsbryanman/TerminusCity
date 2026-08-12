# Terminus City shell integration. Source from .bashrc. Raw shell text never
# crosses into the Terminus CLI: this producer reduces it to the allowlist
# vocabulary before it launches the asynchronous observer.
__terminus_city_started_at=''
__terminus_city_command=''
__terminus_city_subcommand=''
__terminus_city_pair_id=''
__terminus_city_sanitize() {
  local raw="$1" first second base
  read -r first second _ <<< "$raw"
  base="${first##*/}"
  __terminus_city_command=other; __terminus_city_subcommand=''
  [[ -z "$first" || "$first" == *=* || "$first" == */* || "$first" == *[\;\|\&\<\>\`\$\(\)\{\}\[\]\*\?\!~]* ]] && return
  case "$base" in
    git) __terminus_city_command=git; case "$second" in status|log|diff|add|commit|push|pull|checkout|switch|merge|rebase|branch|fetch) __terminus_city_subcommand="$second";; esac ;;
    npm|pnpm|yarn|bun) __terminus_city_command="$base"; case "$second" in test|run|build|install) __terminus_city_subcommand="$second";; esac ;;
    test|vitest|jest|pytest|go|cargo|export|env|printenv|set|pass|gpg|ssh|scp|rsync|curl|wget|mysql|psql|redis-cli|kubectl|aws|gcloud|az|docker|podman|ls|cd|cat|grep|find|make|node|python|python3|pip|ruby|java|code|vim|nvim|nano|tmux|htop|top|df|du|ps|kill|mkdir|rm|mv|cp|touch|chmod|chown|tar|unzip|sed|awk|jq|man|which|echo|clear|history|sudo|apt|dnf|pacman|brew|systemctl|journalctl) __terminus_city_command="$base" ;;
  esac
}
__terminus_city_before_command() {
  __terminus_city_started_at="$(date +%s%3N 2>/dev/null || date +%s)"
  __terminus_city_sanitize "$BASH_COMMAND"
  __terminus_city_pair_id="${RANDOM}${RANDOM}-$(date +%s%N 2>/dev/null || date +%s)"
  [[ "${TERMINUS_CITY_TRACK_STARTED:-}" == 1 && "$__terminus_city_command" != terminus ]] && terminus emit-started "$__terminus_city_command" "$__terminus_city_subcommand" "$__terminus_city_pair_id" >/dev/null 2>&1 &
}
__terminus_city_after_command() {
  local exit_code=$? now duration
  now="$(date +%s%3N 2>/dev/null || date +%s)"; duration=0
  [[ "$__terminus_city_started_at" =~ ^[0-9]+$ && "$now" =~ ^[0-9]+$ ]] && duration=$((now - __terminus_city_started_at))
  [[ -n "$__terminus_city_command" && "$__terminus_city_command" != terminus ]] && terminus emit "$__terminus_city_command" "$__terminus_city_subcommand" "$exit_code" "$duration" "$__terminus_city_pair_id" >/dev/null 2>&1 &
}
trap '__terminus_city_before_command' DEBUG
PROMPT_COMMAND="__terminus_city_after_command${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
