#!/usr/bin/env node

/**
 * DevBrief — Application entry point.
 *
 * Boots the HTTP server and cron scheduler after validating the
 * environment and ensuring the data directory exists.
 *
 * Requirements: 2.1, 2.3
 */

import dotenv from 'dotenv';
dotenv.config();

import { validateEnvVars } from './cli/env-validation.js';
import { ensureDevbriefDir } from './utils/config-io.js';
import { initStore, closeStore } from './utils/store.js';
import { startServer } from './server/index.js';
import { startScheduler, stopScheduler } from './scheduler/index.js';

// Mastra instance — registers the DevBrief workflow with the framework
import { mastra } from './mastra/index.js';

async function main(): Promise<void> {
  // 1. Validate environment variables
  const validation = validateEnvVars();
  if (!validation.valid) {
    for (const error of validation.errors) {
      console.error(`Error: ${error}`);
    }
    process.exit(1);
  }

  // 2. Ensure ~/.devbrief/ and ~/.devbrief/audio/ directories exist
  await ensureDevbriefDir();

  // 3. Initialize the SQLite store
  initStore();

  // 4. Log Mastra workflow registration
  console.log('[devbrief] Mastra workflow registered: devbrief-pipeline');

  // 5. Start the HTTP server
  const server = startServer();

  // 6. Start the cron scheduler
  startScheduler();

  console.log('[devbrief] DevBrief is up and running.');

  // 6. Graceful shutdown on SIGINT / SIGTERM
  const shutdown = () => {
    console.log('\n[devbrief] Shutting down...');
    stopScheduler();
    server.close(() => {
      console.log('[devbrief] HTTP server closed.');
      try {
        closeStore();
        console.log('[devbrief] SQLite store connection closed.');
      } catch (err) {
        console.error('[devbrief] Failed to close SQLite store connection:', err);
      }
      process.exit(0);
    });

    // Force exit after 5 seconds if server doesn't close cleanly
    setTimeout(() => {
      console.error('[devbrief] Forced shutdown after timeout.');
      process.exit(1);
    }, 5000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[devbrief] Fatal error during startup:', err);
  process.exit(1);
});
