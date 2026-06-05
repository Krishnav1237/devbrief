/**
 * DevBrief HTTP server.
 *
 * Exposes the webhook trigger, run history, digest, and audio endpoints,
 * bound to the Tailscale IP. Uses Hono as the HTTP framework with
 * @hono/node-server for the Node.js adapter.
 *
 * Requirements: 2.2, 2.3, 2.5, 10.1, 10.2, 10.4
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { isRunInProgress, runDevBriefPipeline } from '../workflow.js';
import { getRunRecords, getRunRecord } from '../utils/store.js';
import type { DigestResponse } from '../models/index.js';
import { registerDashboardRoutes } from './dashboard.js';
import { detectTailscaleIP } from '../utils/network.js';

// Tailscale IP detection imported from network utility

// ---------------------------------------------------------------------------
// Audio directory
// ---------------------------------------------------------------------------

const DEVBRIEF_DIR = path.join(os.homedir(), '.devbrief');
const AUDIO_DIR = path.join(DEVBRIEF_DIR, 'audio');

// ---------------------------------------------------------------------------
// Hono app factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns the Hono application with all routes configured.
 * Separated from server start for testability.
 *
 * @param getHostname - Function that returns the hostname/IP the server is bound to.
 *                      Used to construct full audio URLs in digest responses.
 * @param getPort     - Function that returns the port the server is listening on.
 */
export function createApp(
  getHostname: () => string,
  getPort: () => number,
): Hono {
  const app = new Hono();

  // POST /trigger — initiate a pipeline run
  app.post('/trigger', async (c) => {
    if (isRunInProgress()) {
      return c.json({ error: 'A pipeline run is already in progress.' }, 409);
    }

    const runId = uuidv4();

    // Start the pipeline asynchronously — don't await, passing the generated runId
    runDevBriefPipeline('webhook', runId).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[server] Pipeline error: ${message}`);
    });

    return c.json({ run_id: runId }, 202);
  });

  // GET /runs — list all run records
  app.get('/runs', (c) => {
    const runs = getRunRecords();
    return c.json(runs);
  });

  // GET /runs/:run_id — get a single run record
  app.get('/runs/:run_id', (c) => {
    const runId = c.req.param('run_id');
    const record = getRunRecord(runId);
    if (!record) {
      return c.json({ error: 'Run not found' }, 404);
    }
    return c.json(record);
  });

  // GET /digest/:run_id — serve locally-hosted digest as DigestResponse JSON
  app.get('/digest/:run_id', (c) => {
    const runId = c.req.param('run_id');
    const record = getRunRecord(runId);
    if (!record) {
      return c.json({ error: 'Run not found' }, 404);
    }

    const hostname = getHostname();
    const port = getPort();

    // Convert local audio path to full HTTP URL, or null if no audio
    let audioUrl: string | null = null;
    if (record.audio_url) {
      audioUrl = `http://${hostname}:${port}/audio/${runId}.mp3`;
    }

    const digest: DigestResponse = {
      run_id: record.run_id,
      briefing_script: record.briefing_script ?? '',
      audio_url: audioUrl,
      generated_at: record.completed_at ?? record.triggered_at,
      criticalCount: record.criticalCount,
      breakingCount: record.breakingCount,
      minorCount: record.minorCount,
    };

    return c.json(digest);
  });

  // GET /audio/:run_id — serve the MP3 audio file
  app.get('/audio/:run_id', (c) => {
    const runId = c.req.param('run_id');
    // Strip .mp3 extension if present in the run_id param
    const cleanRunId = runId.replace(/\.mp3$/, '');

    // Enforce strict UUID format check to block path traversal
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(cleanRunId)) {
      return c.json({ error: 'Invalid run ID format' }, 400);
    }

    const audioPath = path.join(AUDIO_DIR, `${cleanRunId}.mp3`);
    const resolvedPath = path.resolve(audioPath);

    // Secondary defensive check
    if (!resolvedPath.startsWith(AUDIO_DIR)) {
      return c.json({ error: 'Access denied' }, 403);
    }

    if (!fs.existsSync(audioPath)) {
      return c.json({ error: 'Audio file not found' }, 404);
    }

    const audioBuffer = fs.readFileSync(audioPath);
    return new Response(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.length),
      },
    });
  });

  // Register dashboard routes
  registerDashboardRoutes(app);

  return app;
}

// ---------------------------------------------------------------------------
// Server start
// ---------------------------------------------------------------------------

/**
 * Starts the HTTP server on the given hostname and port.
 *
 * @param port     - Port to listen on (default from DEVBRIEF_PORT or 7890)
 * @param hostname - Hostname/IP to bind to (default: auto-detected Tailscale IP)
 * @returns The Node.js HTTP server instance
 */
export function startServer(
  port: number = Number(process.env.DEVBRIEF_PORT) || 7890,
  hostname?: string,
): ReturnType<typeof serve> {
  const resolvedHostname = hostname ?? detectTailscaleIP() ?? '0.0.0.0';
  const resolvedPort = port;

  const app = createApp(
    () => resolvedHostname,
    () => resolvedPort,
  );

  const server = serve({
    fetch: app.fetch,
    port: resolvedPort,
    hostname: resolvedHostname,
  });

  console.log(
    `[server] DevBrief HTTP server listening on http://${resolvedHostname}:${resolvedPort}`,
  );

  return server;
}
