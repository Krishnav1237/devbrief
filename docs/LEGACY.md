# DevBrief Legacy Release Briefing Features

> [!NOTE]
> The features documented below represent the legacy product offering (changelog release tracker, web scraping, and TTS briefing generation). While they are still fully supported and maintained for compatibility, they are completely secondary to the CLI-first Project Maintenance Intelligence engine (`devbrief doctor`).

---

## Architecture Overview

The legacy pipeline operates as an asynchronous multi-step workflow orchestrated by the Mastra framework. It:

1. **Scrapes** release notes and changelogs from tracked repositories using the Olostep web scraper.
2. **Classifies and Summarizes** changes using an LLM (Groq or local Ollama).
3. **Generates spoken audio briefings** using Sarvam AI text-to-speech.
4. **Distributes** digests and alerts via email, Discord, or custom webhooks.

---

## Server API Reference

The HTTP server is optional and runs in the background to serve the dashboard or handle manual web triggers.

### `POST /trigger`

Triggers a pipeline run asynchronously.

- **Response `202 Accepted`**
  ```json
  {
    "run_id": "550e8400-e29b-41d4-a716-446655440000"
  }
  ```
- **Response `409 Conflict`** (a run is already in progress)
  ```json
  {
    "error": "A pipeline run is already in progress."
  }
  ```

---

### `GET /runs`

Returns run records from the SQLite database.

- **Response `200 OK`**
  ```json
  [
    {
      "run_id": "550e8400-e29b-41d4-a716-446655440000",
      "triggered_at": "2026-06-05T10:00:00.000Z",
      "completed_at": "2026-06-05T10:01:30.000Z",
      "status": "completed",
      "criticalCount": 1,
      "breakingCount": 2,
      "minorCount": 5
    }
  ]
  ```

---

### `GET /runs/:run_id`

Retrieves a single run record by ID.

---

### `GET /digest/:run_id`

Serves a locally-hosted briefing digest containing the script and audio link.

- **Response `200 OK`**
  ```json
  {
    "run_id": "550e8400-e29b-41d4-a716-446655440000",
    "briefing_script": "DevBrief for today: express package has 1 critical update...",
    "audio_url": "http://100.x.x.x:7890/audio/550e8400-e29b-41d4-a716-446655440000.mp3",
    "generated_at": "2026-06-05T10:01:30.000Z"
  }
  ```

---

### `GET /audio/:run_id`

Serves the generated MP3 audio file.

---

## Stack Tracking & release configuration

You can track release pages using the CLI stack command.

```bash
npx devbrief stack add express --urls https://github.com/expressjs/express/releases
npx devbrief stack list
npx devbrief stack remove express
```

### Configuration Files

1. **Stack Track List (`~/.devbrief/stack.json`)**
   ```json
   {
     "libraries": [
       {
         "name": "express",
         "urls": ["https://github.com/expressjs/express/releases"],
         "added_at": "2026-06-05T00:00:00.000Z"
       }
     ]
   }
   ```

2. **Notifications config (`~/.devbrief/notification-config.json`)**
   ```json
   {
     "channels": [
       {
         "type": "discord",
         "webhookUrl": "https://discord.com/api/webhooks/..."
       },
       {
         "type": "email",
         "to": "you@example.com",
         "from": "devbrief@example.com"
       }
     ]
   }
   ```

---

## Legacy Environment Configuration

See [docs/legacy/.env.example](legacy/.env.example) for the API key requirements (Groq, Olostep, Sarvam AI) and SMTP credentials.
