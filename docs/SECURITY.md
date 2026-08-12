# Security and privacy

The local event collector stores only the metadata required to animate the city. It accepts events on loopback only and the browser is served from the same loopback relay.

- Raw commands, output, arguments, environment variables, terminal history, and packet data are not persisted.
- The `command` field stored in every event is drawn exclusively from a fixed allowlist (`COMMAND_FAMILIES`). Tokens containing `=` are treated as inline environment assignments and are recorded as `other`. Unrecognized command names — including script paths such as `./deploy.sh` — are also recorded as `other`. No arbitrary user text can appear as the `command` value.
- Current directories are converted into a keyed SHA-256 identity before persistence.
- Known sensitive command families are classified without retaining their arguments.
- Event directories and files are created with owner-only permissions where the platform supports them.
- `terminus pause` is an immediate collection kill switch.

Shell integration must be non-blocking: a missing relay is a missed visualization event, never a failed shell command.
