#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import { loadStackConfig, saveStackConfig } from '../utils/config-io.js';
import type { StackConfiguration, StackLibrary } from '../models/index.js';
import { validateEnvVars } from './env-validation.js';
import { runPipeline } from './run-pipeline.js';

/**
 * Lists all libraries in the stack configuration as a formatted table.
 * Returns the formatted output string.
 */
export async function stackList(): Promise<string> {
  const config = await loadStackConfig();

  if (config.libraries.length === 0) {
    return 'No libraries configured. Use `devbrief stack add` to add libraries.';
  }

  const lines: string[] = [];

  // Calculate column widths
  const nameHeader = 'Library';
  const urlsHeader = 'URLs';
  const maxNameLen = Math.max(
    nameHeader.length,
    ...config.libraries.map((lib) => lib.name.length),
  );

  // Header
  lines.push(`${nameHeader.padEnd(maxNameLen)}  ${urlsHeader}`);
  lines.push(`${'─'.repeat(maxNameLen)}  ${'─'.repeat(urlsHeader.length)}`);

  // Rows
  for (const lib of config.libraries) {
    const urlsStr = lib.urls.join(', ');
    lines.push(`${lib.name.padEnd(maxNameLen)}  ${urlsStr}`);
  }

  return lines.join('\n');
}

/**
 * Removes a library from the stack configuration.
 * Throws an error if the library is not found.
 */
export async function stackRemove(libraryName: string): Promise<void> {
  const config = await loadStackConfig();

  const existingIndex = config.libraries.findIndex(
    (lib) => lib.name === libraryName,
  );

  if (existingIndex === -1) {
    throw new Error(`Library "${libraryName}" not found in the stack configuration.`);
  }

  config.libraries.splice(existingIndex, 1);
  await saveStackConfig(config);
}

/**
 * Adds or updates a library in the stack configuration.
 * If the library already exists, replaces its URLs but keeps the original added_at timestamp.
 * If the library is new, adds it with the current timestamp.
 */
export async function stackAdd(libraryName: string, urls: string[]): Promise<void> {
  const config = await loadStackConfig();

  const existingIndex = config.libraries.findIndex(
    (lib) => lib.name === libraryName,
  );

  if (existingIndex !== -1) {
    // Upsert: replace URLs, keep original added_at
    config.libraries[existingIndex] = {
      ...config.libraries[existingIndex],
      urls,
    };
  } else {
    // New entry
    const entry: StackLibrary = {
      name: libraryName,
      urls,
      added_at: new Date().toISOString(),
    };
    config.libraries.push(entry);
  }

  await saveStackConfig(config);
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('devbrief')
    .description('AI agent that monitors your library stack and delivers voice briefings on changes')
    .version('0.1.0');

  const stack = program
    .command('stack')
    .description('Manage the library stack configuration');

  stack
    .command('add')
    .description('Add or update a library in the stack')
    .argument('<library>', 'Name of the library to add')
    .requiredOption('--urls <urls>', 'Comma-separated list of changelog/release page URLs')
    .action(async (library: string, options: { urls: string }) => {
      try {
        const urls = options.urls.split(',').map((u) => u.trim());
        await stackAdd(library, urls);
        console.log(`Added "${library}" with ${urls.length} URL(s) to the stack.`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  stack
    .command('remove')
    .description('Remove a library from the stack')
    .argument('<library>', 'Name of the library to remove')
    .action(async (library: string) => {
      try {
        await stackRemove(library);
        console.log(`Removed "${library}" from the stack.`);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    });

  stack
    .command('list')
    .description('List all libraries in the stack')
    .action(async () => {
      const output = await stackList();
      console.log(output);
    });

  program
    .command('run')
    .description('Run the DevBrief pipeline manually (without the HTTP server)')
    .action(async () => {
      // Load .env file
      dotenv.config();

      // Validate required environment variables
      const validation = validateEnvVars();
      if (!validation.valid) {
        for (const error of validation.errors) {
          console.error(`Error: ${error}`);
        }
        process.exit(1);
      }

      console.log('Starting DevBrief pipeline (manual trigger)...');
      await runPipeline('manual');
      console.log('Pipeline run complete.');
    });

  return program;
}

// Parse CLI arguments when this file is the entry point.
// Skip when imported by test runners (vitest sets process.env.VITEST).
// The path check handles npx/node execution via bin symlinks.
const isTestEnvironment = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

if (!isTestEnvironment) {
  createProgram().parse();
}