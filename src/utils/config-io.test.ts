import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// We need to mock os.homedir() so tests use a temp directory instead of the real home.
// We do this by mocking the module-level constants via a dynamic import approach.
// Instead, we'll test the functions by temporarily setting up a fake home dir.

import { vi } from 'vitest';

// Mock os.homedir to return a temp directory
const testDir = join(tmpdir(), `devbrief-test-${randomUUID()}`);

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    homedir: () => testDir,
  };
});

// Import after mock setup
const { ensureDevbriefDir, loadStackConfig, saveStackConfig, loadNotificationConfig } =
  await import('./config-io.js');

const devbriefDir = join(testDir, '.devbrief');
const audioDir = join(devbriefDir, 'audio');
const stackConfigPath = join(devbriefDir, 'stack-config.json');
const notificationConfigPath = join(devbriefDir, 'notification-config.json');

describe('config-io', () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('ensureDevbriefDir', () => {
    it('creates ~/.devbrief/ and audio/ subdirectory', async () => {
      await ensureDevbriefDir();
      const { stat } = await import('node:fs/promises');
      const devbriefStat = await stat(devbriefDir);
      expect(devbriefStat.isDirectory()).toBe(true);
      const audioStat = await stat(audioDir);
      expect(audioStat.isDirectory()).toBe(true);
    });

    it('is idempotent — calling twice does not throw', async () => {
      await ensureDevbriefDir();
      await expect(ensureDevbriefDir()).resolves.toBeUndefined();
    });
  });

  describe('loadStackConfig', () => {
    it('returns default empty config when file does not exist', async () => {
      const config = await loadStackConfig();
      expect(config).toEqual({ libraries: [] });
    });

    it('loads a valid stack config from disk', async () => {
      await mkdir(devbriefDir, { recursive: true });
      const validConfig = {
        libraries: [
          {
            name: 'react',
            urls: ['https://github.com/facebook/react/releases'],
            added_at: '2024-01-15T10:00:00.000Z',
          },
        ],
      };
      await writeFile(stackConfigPath, JSON.stringify(validConfig), 'utf-8');

      const config = await loadStackConfig();
      expect(config).toEqual(validConfig);
    });

    it('throws on invalid JSON', async () => {
      await mkdir(devbriefDir, { recursive: true });
      await writeFile(stackConfigPath, '{ not valid json }}}', 'utf-8');

      await expect(loadStackConfig()).rejects.toThrow('invalid JSON');
    });

    it('throws with clear Zod error on malformed config', async () => {
      await mkdir(devbriefDir, { recursive: true });
      // Missing required 'libraries' field
      await writeFile(stackConfigPath, JSON.stringify({ wrongField: true }), 'utf-8');

      await expect(loadStackConfig()).rejects.toThrow('Invalid stack configuration');
    });

    it('throws with clear error on invalid library entry', async () => {
      await mkdir(devbriefDir, { recursive: true });
      // Library with missing required fields
      await writeFile(
        stackConfigPath,
        JSON.stringify({ libraries: [{ name: '' }] }),
        'utf-8',
      );

      await expect(loadStackConfig()).rejects.toThrow('Invalid stack configuration');
    });
  });

  describe('saveStackConfig', () => {
    it('saves a valid config and can be loaded back', async () => {
      const config = {
        libraries: [
          {
            name: 'zod',
            urls: ['https://github.com/colinhacks/zod/releases'],
            added_at: '2024-06-01T12:00:00.000Z',
          },
        ],
      };

      await saveStackConfig(config);
      const loaded = await loadStackConfig();
      expect(loaded).toEqual(config);
    });

    it('throws when trying to save an invalid config', async () => {
      const badConfig = { libraries: 'not-an-array' } as any;
      await expect(saveStackConfig(badConfig)).rejects.toThrow(
        'Cannot save invalid stack configuration',
      );
    });
  });

  describe('loadNotificationConfig', () => {
    it('returns default empty config when file does not exist', async () => {
      const config = await loadNotificationConfig();
      expect(config).toEqual({ channels: [] });
    });

    it('loads a valid webhook channel config', async () => {
      await mkdir(devbriefDir, { recursive: true });
      const validConfig = {
        channels: [
          { type: 'webhook', url: 'https://hooks.example.com/devbrief' },
        ],
      };
      await writeFile(notificationConfigPath, JSON.stringify(validConfig), 'utf-8');

      const config = await loadNotificationConfig();
      expect(config).toEqual(validConfig);
    });

    it('loads a valid discord channel config', async () => {
      await mkdir(devbriefDir, { recursive: true });
      const validConfig = {
        channels: [
          { type: 'discord', webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
        ],
      };
      await writeFile(notificationConfigPath, JSON.stringify(validConfig), 'utf-8');

      const config = await loadNotificationConfig();
      expect(config).toEqual(validConfig);
    });

    it('loads a valid email channel config', async () => {
      await mkdir(devbriefDir, { recursive: true });
      const validConfig = {
        channels: [
          {
            type: 'email',
            smtp: {
              host: 'smtp.example.com',
              port: 587,
              secure: false,
              auth: { user: 'user@example.com', pass: 'secret' },
            },
            to: 'dev@example.com',
          },
        ],
      };
      await writeFile(notificationConfigPath, JSON.stringify(validConfig), 'utf-8');

      const config = await loadNotificationConfig();
      expect(config).toEqual(validConfig);
    });

    it('throws on invalid JSON', async () => {
      await mkdir(devbriefDir, { recursive: true });
      await writeFile(notificationConfigPath, 'not json at all', 'utf-8');

      await expect(loadNotificationConfig()).rejects.toThrow('invalid JSON');
    });

    it('throws with clear Zod error on wrong field names', async () => {
      await mkdir(devbriefDir, { recursive: true });
      // Wrong field name: 'webhook_url' instead of 'webhookUrl'
      await writeFile(
        notificationConfigPath,
        JSON.stringify({
          channels: [{ type: 'discord', webhook_url: 'https://discord.com/api/webhooks/123/abc' }],
        }),
        'utf-8',
      );

      await expect(loadNotificationConfig()).rejects.toThrow('Invalid notification configuration');
    });

    it('throws with clear Zod error on missing required fields', async () => {
      await mkdir(devbriefDir, { recursive: true });
      // Email channel missing smtp config
      await writeFile(
        notificationConfigPath,
        JSON.stringify({
          channels: [{ type: 'email', to: 'dev@example.com' }],
        }),
        'utf-8',
      );

      await expect(loadNotificationConfig()).rejects.toThrow('Invalid notification configuration');
    });
  });
});
