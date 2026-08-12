# Terminus City

Terminus City turns sanitized local development activity into a living procedural city. It observes; it never changes or repeats shell commands.

## Quick start

```bash
npm run dev
```

Open `http://127.0.0.1:31338`. In a second terminal, send a safe test event:

```bash
node bin/terminus.mjs emit git status 0 82
```

## Commands

```text
terminus start              Start the local city relay
terminus dev                Start the relay and open its local URL
terminus status             Report local relay and privacy state
terminus pause | resume     Stop or resume event collection
terminus emit CMD [SUB] [EXIT] [DURATION_MS]
terminus doctor             Check the local installation
```

The event store defaults to `~/.local/share/terminus-city`. Set `TERMINUS_CITY_DATA_DIR` to use another location. The relay always binds to `127.0.0.1` unless the source is intentionally changed.

## Privacy

Only a command family drawn from a fixed allowlist, a safe subcommand, result, duration, and hashed current-directory key are retained. Unrecognized commands (including script paths and inline environment assignments) are recorded as `other`. Raw command lines, output, environment variables, terminal history, and network payloads are never stored. See [SECURITY.md](docs/SECURITY.md).

## Development

```bash
npm test
npm run doctor
```
