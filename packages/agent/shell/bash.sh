# Terminus City shell integration. Add this exact file by sourcing it from .bashrc.
# It never blocks a command: failures only mean a missed visual event.
__terminus_city_started_at=''
__terminus_city_command=''
__terminus_city_before_command() {
  __terminus_city_started_at="$(date +%s%3N 2>/dev/null || date +%s)"
  __terminus_city_command="$BASH_COMMAND"
}
__terminus_city_after_command() {
  local exit_code=$? now duration command
  now="$(date +%s%3N 2>/dev/null || date +%s)"
  duration=0
  [[ "$__terminus_city_started_at" =~ ^[0-9]+$ && "$now" =~ ^[0-9]+$ ]] && duration=$((now - __terminus_city_started_at))
  command="${__terminus_city_command%% *}"
  [[ -n "$command" && "$command" != "terminus" ]] && terminus emit "$command" '' "$exit_code" "$duration" >/dev/null 2>&1 &
}
trap '__terminus_city_before_command' DEBUG
PROMPT_COMMAND="__terminus_city_after_command${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
