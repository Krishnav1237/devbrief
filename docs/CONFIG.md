# DevBrief Configuration Reference

DevBrief's CLI commands require **no configuration and no API keys**. They run entirely locally.

If you choose to use the optional local HTTP server and dashboard, you can configure the settings below.

---

## Local Server & Dashboard Configuration

Copy `.env.example` from the root of the project to `.env` to customize these settings:

| Variable | Default | Description |
|---|---|---|
| `DEVBRIEF_PORT` | `7890` | Port for the local dashboard HTTP server |
| `TAILSCALE_IP` | auto-detected | Override the Tailscale IP bound to. Automatically binds to the first detected `100.x.x.x` interface. Falls back to `0.0.0.0` if Tailscale is not present. |
| `DEVBRIEF_OFFLINE` | `0` | Set to `1` to run all scan/fix/upgrade operations offline, bypassing active network registry requests and immediately fallback to lockfiles/cached versions. |

---

## Directory Layout

DevBrief stores local configuration and state in your user home directory:

- `~/.devbrief/` — Home directory for storage
- `~/.devbrief/devbrief.db` — SQLite database tracking project metadata and history
- `~/.devbrief/eol-cache/` — Dynamic EOL lifecycle timelines cached from `endoflife.date` (24h TTL)
- `~/.devbrief/registry-cache/` — Package version registry lookup responses cached from npm/PyPI/Crates/Go Proxy (12h TTL)
- `~/.devbrief/stack.json` — Tracks release monitoring (legacy)
- `~/.devbrief/audio/` — Stores generated briefing recordings (legacy)
