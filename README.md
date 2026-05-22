# DevBrief

An AI agent that monitors your library stack, scrapes changelogs daily, and delivers a concise voice briefing on what changed and what needs action.

Instead of manually checking GitHub releases, Twitter, and docs across the 10–30 libraries you actively use, DevBrief collapses that into a 2-minute voice briefing each morning.

---

## How It Works

```mermaid
flowchart TD
    A["Daily Trigger\n(Cron / API / CLI)"]:::trigger --> B["Scrape Changelogs\nfrom your library stack"]:::step
    B --> C["Deduplicate\nskip already-seen changes"]:::step
    C --> D["Summarize + Classify\nvia LLM (Groq / Ollama)"]:::step
    D --> E["Generate Briefing Script\nordered by priority"]:::step
    E --> F["Text-to-Speech\nvia Sarvam AI"]:::step
    F --> G["Publish + Notify\nWebhook / Discord / Email"]:::output

    classDef trigger fill:#1a1a2e,color:#ffffff,stroke:#16213e
    classDef step fill:#0f3460,color:#ffffff,stroke:#1a1a2e
    classDef output fill:#533483,color:#ffffff,stroke:#1a1a2e
```

Every step is fault-isolated. If TTS fails, you still get a text digest. If one library's scrape fails, the others still process normally.

---

## Quick Start

```bash
git clone <repo-url>
cd devbrief
npm install
cp .env.example .env
```

Fill in your `.env` (see [Environment Variables](#environment-variables) below), then:

```bash
# Add libraries to monitor
npx devbrief stack add react --urls "https://github.com/facebook/react/releases"
npx devbrief stack add next --urls "https://github.com/vercel/next.js/releases,https://nextjs.org/blog"

# Run the pipeline
npx devbrief run
```

That's it. You'll see scraped changes, deduplication results, LLM classification, and (if configured) an audio briefing generated.

---

## Prerequisites

| Dependency | Why | Install |
|---|---|---|
| **Node.js 18+** | Runtime | [nodejs.org](https://nodejs.org) |
| **ffmpeg** | Stitches audio chunks into a single MP3 | `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Ubuntu) |
| **Tailscale** | Secure access to the HTTP server without exposing ports | [tailscale.com/download](https://tailscale.com/download) |

---

## Environment Variables

Copy `.env.example` to `.env`. The variables are grouped by what they enable.

### Required (pipeline won't run without these)

| Variable | Description |
|---|---|
| `OLOSTEP_API_KEY` | Olostep web scraping — renders JS-heavy pages and returns markdown |
| `SARVAM_API_KEY` | Sarvam AI text-to-speech — converts briefing scripts to audio |

You also need **at least one** LLM provider:

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq cloud LLM (uses Llama 3.3) |
| `OLLAMA_BASE_URL` | Local Ollama instance (e.g. `http://localhost:11434`) |

### Optional — Cloud Sync

These enable cross-device persistence via HydraDB. Without them, DevBrief works fully in local-only mode (SQLite).

| Variable | Description |
|---|---|
| `HYDRADB_API_KEY` | HydraDB cloud knowledge store |
| `HYDRADB_TENANT_ID` | Your HydraDB tenant (required if API key is set) |

### Optional — Notifications

Configure these only if you want push notifications after each run.

| Variable | Description |
|---|---|
| `DISCORD_WEBHOOK_URL` | Discord channel webhook |
| `SMTP_HOST` | SMTP server for email notifications |
| `SMTP_PORT` | SMTP port |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password |

### Optional — Server Configuration

| Variable | Default | Description |
|---|---|---|
| `TAILSCALE_IP` | Auto-detect | Tailscale IP to bind to (finds `100.x.x.x` automatically) |
| `DEVBRIEF_PORT` | `7890` | HTTP server port |
| `DEVBRIEF_CRON` | `0 7 * * *` | Cron expression (default: 7 AM daily) |
| `TZ` | System local | Timezone for cron (e.g. `America/New_York`) |

---

## CLI Usage

### Managing Your Library Stack

```bash
# Add a library (single URL)
npx devbrief stack add react --urls "https://github.com/facebook/react/releases"

# Add with multiple changelog sources
npx devbrief stack add next --urls "https://github.com/vercel/next.js/releases,https://nextjs.org/blog"

# Update URLs for an existing library (upsert — replaces URLs, keeps history)
npx devbrief stack add react --urls "https://github.com/facebook/react/releases,https://react.dev/blog"

# Remove a library
npx devbrief stack remove react

# List everything you're monitoring
npx devbrief stack list
```

### Running the Pipeline

```bash
npx devbrief run
```

This runs the full pipeline once (scrape → deduplicate → summarize → script → TTS → publish → notify) and prints a summary:

```
Run ID:    a1b2c3d4-...
Status:    completed
Changes:   3 new
Errors:    0
Audio:     ~/.devbrief/audio/a1b2c3d4.mp3
```

---

## Server Mode

For always-on operation, start the HTTP server with the built-in cron scheduler:

```bash
npm start        # production (compiled)
npm run dev      # development (tsx, auto-reload)
```

The server binds to your Tailscale IP on port 7890. The cron scheduler triggers the pipeline automatically based on `DEVBRIEF_CRON`.

**Authentication:** Tailscale tailnet membership is the only auth. If your device is on the tailnet, you have access. No passwords or tokens needed.

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/trigger` | Start a pipeline run. Returns `202` with `{ "run_id": "..." }`. Returns `409` if already running. |
| `GET` | `/runs` | List all runs (newest first) |
| `GET` | `/runs/:run_id` | Get full details for a specific run |
| `GET` | `/digest/:run_id` | Get the briefing script + audio URL as JSON |
| `GET` | `/audio/:run_id.mp3` | Stream/download the audio briefing |

Example — trigger a run and get the audio:

```bash
# Trigger
curl -X POST http://100.x.x.x:7890/trigger
# → {"run_id": "a1b2c3d4-..."}

# Download audio once complete
curl http://100.x.x.x:7890/audio/a1b2c3d4.mp3 --output briefing.mp3
```

---

## Notifications (Optional)

DevBrief can notify you after each run via webhook, Discord, or email. Configure channels in `~/.devbrief/notification-config.json`:

```json
{
  "channels": [
    {
      "type": "webhook",
      "url": "https://your-endpoint.example.com/devbrief"
    },
    {
      "type": "discord",
      "webhookUrl": "https://discord.com/api/webhooks/..."
    },
    {
      "type": "email",
      "smtp": {
        "host": "smtp.gmail.com",
        "port": 587,
        "secure": false,
        "auth": { "user": "you@gmail.com", "pass": "app-password" }
      },
      "to": "you@gmail.com"
    }
  ]
}
```

Use any combination. If one channel fails, the others still deliver.

---

## Data Storage

### Local (always active — no configuration needed)

All data lives in `~/.devbrief/` (created automatically on first run):

| Path | Contents |
|---|---|
| `devbrief.db` | SQLite database — change entries, run records, dedup index |
| `audio/` | Generated MP3 briefings (`{run_id}.mp3`) |
| `stack-config.json` | Your monitored libraries |
| `notification-config.json` | Notification channel settings |

Data older than 30 days is automatically purged at the start of each run.

### Cloud Sync via HydraDB (optional)

When `HYDRADB_API_KEY` is set, classified change entries and run summaries are synced to [HydraDB](https://docs.usecortex.ai) for:

- Cross-device access (run from laptop, check from phone)
- Semantic recall ("what breaking changes did I see this month?")

Important: deduplication always runs against local SQLite. HydraDB is a sync layer, not the dedup source. If the API key isn't set, everything works normally in local-only mode.

---

## Architecture

Built with [Mastra](https://mastra.ai) for workflow orchestration. Each pipeline step is a `createStep()` that chains via `.then()`. A unified `pipelineStatus` field flows through all steps — if any step fails, downstream steps skip cleanly.

### System Overview

```mermaid
flowchart TD
    subgraph TRIGGERS["Trigger Layer"]
        direction LR
        CRON["Cron Schedule\n(Daily 7 AM)"]:::trigger
        HTTP["HTTP API\nPOST /trigger"]:::trigger
        CLI["CLI\nnpx devbrief run"]:::trigger
    end

    subgraph PIPELINE["Core Pipeline — Mastra Workflow Engine"]
        direction TD
        P1["Scrape Changelogs"]:::core
        P2["Deduplicate"]:::core
        P3["Summarize via LLM"]:::core
        P4["Generate Script"]:::core
        P5["Text-to-Speech"]:::core
        P6["Publish & Notify"]:::core
        P1 --> P2 --> P3 --> P4 --> P5 --> P6
    end

    subgraph SERVICES["External Services"]
        direction LR
        OLO["Olostep\nWeb Scraping"]:::external
        LLM["Groq / Ollama\nLLM Inference"]:::external
        SAR["Sarvam AI\nText-to-Speech"]:::external
    end

    subgraph STORE["Storage Layer"]
        direction LR
        SQL[("SQLite\nLocal")]:::storage
        HDB[("HydraDB\nCloud (optional)")]:::storage
    end

    subgraph DELIVER["Notification Channels"]
        direction LR
        WH["Webhook"]:::delivery
        DC["Discord"]:::delivery
        EM["Email"]:::delivery
    end

    TRIGGERS --> PIPELINE
    P1 -.-> OLO
    P3 -.-> LLM
    P5 -.-> SAR
    P2 --> SQL
    P3 -.-> HDB
    P6 --> DELIVER

    classDef trigger fill:#1a1a2e,color:#ffffff,stroke:#16213e
    classDef core fill:#0f3460,color:#ffffff,stroke:#1a1a2e
    classDef external fill:#e94560,color:#ffffff,stroke:#1a1a2e
    classDef storage fill:#533483,color:#ffffff,stroke:#1a1a2e
    classDef delivery fill:#0f3460,color:#ffffff,stroke:#1a1a2e
```

### Error Handling

```mermaid
flowchart TD
    START(["Pipeline Triggered"]):::start --> SCRAPE["Scrape changelogs\nfrom monitored libraries"]:::core
    SCRAPE --> DEDUP["Deduplicate against\nlocal SQLite store"]:::core

    DEDUP --> CHECK1{"New changes\nfound?"}:::decision
    CHECK1 -- "No" --> DONE1(["Done — no new changes"]):::success
    CHECK1 -- "Yes" --> SUMMARIZE["Summarize + classify\nvia LLM"]:::core

    SUMMARIZE --> CHECK2{"LLM\nsucceeded?"}:::decision
    CHECK2 -- "No" --> FAIL(["Abort — LLM failure"]):::failure
    CHECK2 -- "Yes" --> SCRIPT["Generate briefing\nscript"]:::core

    SCRIPT --> TTS["Text-to-Speech\nvia Sarvam AI"]:::core
    TTS --> CHECK3{"TTS\nsucceeded?"}:::decision
    CHECK3 -- "No" --> TEXTONLY["Text-only digest"]:::fallback
    CHECK3 -- "Yes" --> AUDIO["Audio + text digest"]:::core

    TEXTONLY --> PUBLISH["Publish digest"]:::core
    AUDIO --> PUBLISH
    PUBLISH --> NOTIFY["Notify channels"]:::core
    NOTIFY --> DONE2(["Run complete"]):::success

    classDef start fill:#1a1a2e,color:#ffffff,stroke:#16213e
    classDef core fill:#0f3460,color:#ffffff,stroke:#1a1a2e
    classDef decision fill:#16213e,color:#ffffff,stroke:#0f3460
    classDef success fill:#1b5e20,color:#ffffff,stroke:#1a1a2e
    classDef failure fill:#b71c1c,color:#ffffff,stroke:#1a1a2e
    classDef fallback fill:#e65100,color:#ffffff,stroke:#1a1a2e
```

### Project Structure

```mermaid
flowchart TD
    subgraph ENTRY["Entry Points"]
        direction LR
        IDX["index.ts\nServer + scheduler bootstrap"]:::entry
        CLII["cli/\nStack management & manual run"]:::entry
    end

    subgraph ENGINE["Orchestration"]
        direction LR
        WF["workflow.ts\nPipeline runner"]:::orchestration
        MASTRA["mastra/\nMastra workflow definition"]:::orchestration
    end

    subgraph STEPS["Pipeline Steps — src/steps/"]
        direction LR
        ST1["scrape"]:::step
        ST2["deduplicate"]:::step
        ST3["summarize"]:::step
        ST4["generate-script"]:::step
        ST5["tts"]:::step
        ST6["publish"]:::step
        ST7["notify"]:::step
    end

    subgraph INFRA["Infrastructure"]
        direction LR
        SRV["server/\nHono HTTP API"]:::infra
        SCHED["scheduler/\nnode-cron"]:::infra
        UTIL["utils/\nConfig, Store, Purge"]:::infra
        MOD["models/\nZod schemas"]:::infra
    end

    ENTRY --> ENGINE
    ENGINE --> STEPS
    STEPS --> INFRA

    classDef entry fill:#1a1a2e,color:#ffffff,stroke:#16213e
    classDef orchestration fill:#0f3460,color:#ffffff,stroke:#1a1a2e
    classDef step fill:#533483,color:#ffffff,stroke:#1a1a2e
    classDef infra fill:#16213e,color:#ffffff,stroke:#0f3460
```

---

## Development

```bash
npm test          # Run tests (vitest)
npm run test:watch  # Watch mode
npm run build     # Compile TypeScript
npm run dev       # Dev server with tsx (auto-reload)
```

---

## License

MIT
