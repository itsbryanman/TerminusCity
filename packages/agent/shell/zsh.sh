# Terminus City shell integration. It is asynchronous and cannot block commands.
typeset -g __terminus_city_started_at __terminus_city_command
function __terminus_city_preexec() { __terminus_city_started_at=$EPOCHREALTIME; __terminus_city_command="${1%% *}" }
function __terminus_city_precmd() { local code=$?; [[ -n "$__terminus_city_command" && "$__terminus_city_command" != terminus ]] && terminus emit "$__terminus_city_command" '' "$code" 0 >/dev/null 2>&1 & }
autoload -Uz add-zsh-hook
add-zsh-hook preexec __terminus_city_preexec
add-zsh-hook precmd __terminus_city_precmd
