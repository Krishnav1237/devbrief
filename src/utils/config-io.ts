import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  StackConfigurationSchema,
  NotificationConfigurationSchema,
  type StackConfiguration,
  type NotificationConfiguration,
} from '../models/index.js';

const DEVBRIEF_DIR = join(homedir(), '.devbrief');
const AUDIO_DIR = join(DEVBRIEF_DIR, 'audio');
const STACK_CONFIG_PATH = join(DEVBRIEF_DIR, 'stack-config.json');
const NOTIFICATION_CONFIG_PATH = join(DEVBRIEF_DIR, 'notification-config.json');

/**
 * Ensures the ~/.devbrief/ directory and its audio/ subdirectory exist.
 * Safe to call multiple times — uses recursive mkdir which is a no-op if dirs exist.
 */
export async function ensureDevbriefDir(): Promise<void> {
  await mkdir(AUDIO_DIR, { recursive: true });
}

/**
 * Loads the stack configuration from ~/.devbrief/stack-config.json.
 * Returns a default empty config ({ libraries: [] }) if the file doesn't exist.
 * Throws with a clear message if the file exists but contains invalid JSON or fails Zod validation.
 */
export async function loadStackConfig(): Promise<StackConfiguration> {
  await ensureDevbriefDir();

  let raw: string;
  try {
    raw = await readFile(STACK_CONFIG_PATH, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return { libraries: [] };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse ${STACK_CONFIG_PATH}: file contains invalid JSON.`,
    );
  }

  const result = StackConfigurationSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid stack configuration in ${STACK_CONFIG_PATH}:\n${issues}`,
    );
  }

  return result.data;
}

/**
 * Saves the stack configuration to ~/.devbrief/stack-config.json.
 * Creates the directory if it doesn't exist. Validates the config before writing.
 */
export async function saveStackConfig(config: StackConfiguration): Promise<void> {
  await ensureDevbriefDir();

  const result = StackConfigurationSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Cannot save invalid stack configuration:\n${issues}`,
    );
  }

  await writeFile(STACK_CONFIG_PATH, JSON.stringify(result.data, null, 2) + '\n', 'utf-8');
}

/**
 * Loads the notification configuration from ~/.devbrief/notification-config.json.
 * Returns a default empty config ({ channels: [] }) if the file doesn't exist.
 * Throws with a clear message if the file exists but contains invalid JSON or fails Zod validation,
 * so that malformed config is caught early rather than causing cryptic failures in the Notifier.
 */
export async function loadNotificationConfig(): Promise<NotificationConfiguration> {
  await ensureDevbriefDir();

  let raw: string;
  try {
    raw = await readFile(NOTIFICATION_CONFIG_PATH, 'utf-8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return { channels: [] };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse ${NOTIFICATION_CONFIG_PATH}: file contains invalid JSON.`,
    );
  }

  const result = NotificationConfigurationSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid notification configuration in ${NOTIFICATION_CONFIG_PATH}:\n${issues}`,
    );
  }

  return result.data;
}

/** Type guard for Node.js system errors with a `code` property. */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
