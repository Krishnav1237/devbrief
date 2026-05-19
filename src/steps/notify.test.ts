import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import nodemailer from 'nodemailer';
import {
  sendWebhook,
  sendDiscord,
  sendEmail,
  deliverNotifications,
  notifyStep,
  type NotifyInput,
} from './notify.js';
import type { NotificationChannel, SMTPConfig } from '../models/index.js';

// ---------------------------------------------------------------------------
// Mock axios and nodemailer
// ---------------------------------------------------------------------------

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

vi.mock('nodemailer', () => {
  const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'test-id' });
  return {
    default: {
      createTransport: vi.fn().mockReturnValue({
        sendMail: sendMailMock,
      }),
    },
    __sendMailMock: sendMailMock,
  };
});

vi.mock('../utils/config-io.js', () => ({
  loadNotificationConfig: vi.fn(),
}));

import { loadNotificationConfig } from '../utils/config-io.js';

const mockedAxiosPost = vi.mocked(axios.post);
const mockedLoadNotificationConfig = vi.mocked(loadNotificationConfig);

// ---------------------------------------------------------------------------
// sendWebhook
// ---------------------------------------------------------------------------

describe('sendWebhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends POST with digest_link and run_id', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: 'ok' } as any);

    const result = await sendWebhook(
      'https://example.com/hook',
      'https://digest.link/123',
      'run-abc',
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockedAxiosPost).toHaveBeenCalledWith('https://example.com/hook', {
      digest_link: 'https://digest.link/123',
      run_id: 'run-abc',
    });
  });

  it('sends null run_id when not provided', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: 'ok' } as any);

    await sendWebhook('https://example.com/hook', 'https://digest.link/123');

    expect(mockedAxiosPost).toHaveBeenCalledWith('https://example.com/hook', {
      digest_link: 'https://digest.link/123',
      run_id: null,
    });
  });

  it('returns failure on network error', async () => {
    mockedAxiosPost.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await sendWebhook(
      'https://example.com/hook',
      'https://digest.link/123',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Webhook delivery failed');
    expect(result.error).toContain('Connection refused');
  });
});

// ---------------------------------------------------------------------------
// sendDiscord
// ---------------------------------------------------------------------------

describe('sendDiscord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends embed with digest link to Discord webhook', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: 'ok' } as any);

    const result = await sendDiscord(
      'https://discord.com/api/webhooks/123/abc',
      'https://digest.link/123',
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    const call = mockedAxiosPost.mock.calls[0];
    expect(call[0]).toBe('https://discord.com/api/webhooks/123/abc');

    const body = call[1] as any;
    expect(body.embeds).toHaveLength(1);
    expect(body.embeds[0].title).toBe('📋 DevBrief Daily Digest');
    expect(body.embeds[0].description).toContain('https://digest.link/123');
    expect(body.embeds[0].color).toBe(0x5865f2);
  });

  it('returns failure on Discord API error', async () => {
    mockedAxiosPost.mockRejectedValueOnce(new Error('403 Forbidden'));

    const result = await sendDiscord(
      'https://discord.com/api/webhooks/123/abc',
      'https://digest.link/123',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Discord delivery failed');
    expect(result.error).toContain('403 Forbidden');
  });
});

// ---------------------------------------------------------------------------
// sendEmail
// ---------------------------------------------------------------------------

describe('sendEmail', () => {
  const smtpConfig: SMTPConfig = {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'user@example.com', pass: 'secret' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates transporter with correct SMTP config', async () => {
    const result = await sendEmail(
      smtpConfig,
      'dev@example.com',
      'https://digest.link/123',
    );

    expect(result.success).toBe(true);
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'user@example.com', pass: 'secret' },
    });
  });

  it('sends email with correct subject and HTML body', async () => {
    await sendEmail(smtpConfig, 'dev@example.com', 'https://digest.link/123');

    const transport = vi.mocked(nodemailer.createTransport).mock.results[0]
      .value as any;
    const sendMailCall = transport.sendMail.mock.calls[0][0];

    expect(sendMailCall.from).toBe('user@example.com');
    expect(sendMailCall.to).toBe('dev@example.com');
    expect(sendMailCall.subject).toBe('DevBrief Daily Digest');
    expect(sendMailCall.html).toContain('https://digest.link/123');
    expect(sendMailCall.html).toContain('DevBrief Daily Digest');
  });

  it('returns failure on SMTP error', async () => {
    const transport = vi.mocked(nodemailer.createTransport).mock.results[0]
      ?.value as any;

    // Re-mock createTransport to return a failing sendMail
    vi.mocked(nodemailer.createTransport).mockReturnValueOnce({
      sendMail: vi.fn().mockRejectedValueOnce(new Error('SMTP auth failed')),
    } as any);

    const result = await sendEmail(
      smtpConfig,
      'dev@example.com',
      'https://digest.link/123',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Email delivery failed');
    expect(result.error).toContain('SMTP auth failed');
  });
});

// ---------------------------------------------------------------------------
// deliverNotifications
// ---------------------------------------------------------------------------

describe('deliverNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array for empty channels', async () => {
    const results = await deliverNotifications([], 'https://digest.link/123');
    expect(results).toEqual([]);
  });

  it('delivers to webhook channel', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: 'ok' } as any);

    const channels: NotificationChannel[] = [
      { type: 'webhook', url: 'https://example.com/hook' },
    ];

    const results = await deliverNotifications(
      channels,
      'https://digest.link/123',
      'run-abc',
    );

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe('webhook');
    expect(results[0].success).toBe(true);
  });

  it('delivers to discord channel', async () => {
    mockedAxiosPost.mockResolvedValueOnce({ data: 'ok' } as any);

    const channels: NotificationChannel[] = [
      { type: 'discord', webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
    ];

    const results = await deliverNotifications(
      channels,
      'https://digest.link/123',
    );

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe('discord');
    expect(results[0].success).toBe(true);
  });

  it('delivers to email channel', async () => {
    const channels: NotificationChannel[] = [
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
    ];

    const results = await deliverNotifications(
      channels,
      'https://digest.link/123',
    );

    expect(results).toHaveLength(1);
    expect(results[0].channel).toBe('email');
    expect(results[0].success).toBe(true);
  });

  it('attempts all channels even when some fail', async () => {
    // First call (webhook) fails, second call (discord) succeeds
    mockedAxiosPost
      .mockRejectedValueOnce(new Error('Webhook down'))
      .mockResolvedValueOnce({ data: 'ok' } as any);

    const channels: NotificationChannel[] = [
      { type: 'webhook', url: 'https://example.com/hook' },
      { type: 'discord', webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
    ];

    const results = await deliverNotifications(
      channels,
      'https://digest.link/123',
    );

    expect(results).toHaveLength(2);
    expect(results[0].channel).toBe('webhook');
    expect(results[0].success).toBe(false);
    expect(results[1].channel).toBe('discord');
    expect(results[1].success).toBe(true);
  });

  it('handles all channels failing', async () => {
    mockedAxiosPost
      .mockRejectedValueOnce(new Error('Webhook down'))
      .mockRejectedValueOnce(new Error('Discord down'));

    vi.mocked(nodemailer.createTransport).mockReturnValueOnce({
      sendMail: vi.fn().mockRejectedValueOnce(new Error('SMTP down')),
    } as any);

    const channels: NotificationChannel[] = [
      { type: 'webhook', url: 'https://example.com/hook' },
      { type: 'discord', webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
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
    ];

    const results = await deliverNotifications(
      channels,
      'https://digest.link/123',
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => !r.success)).toBe(true);
    expect(results[0].error).toContain('Webhook');
    expect(results[1].error).toContain('Discord');
    expect(results[2].error).toContain('Email');
  });
});

// ---------------------------------------------------------------------------
// notifyStep (Mastra step)
// ---------------------------------------------------------------------------

describe('notifyStep', () => {
  const RUN_ID = '550e8400-e29b-41d4-a716-446655440000';

  const baseInput: NotifyInput = {
    digestLink: 'http://100.64.0.1:7890/digest/550e8400-e29b-41d4-a716-446655440000',
    briefingScript: 'Good morning! Here is your DevBrief.',
    audioUrl: null,
    classifiedEntries: [],
    errors: [],
    runId: RUN_ID,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct step metadata', () => {
    expect(notifyStep.id).toBe('notify');
    expect(notifyStep.description).toBeDefined();
  });

  it('returns skip_to_finalize when pipelineStatus is skip_to_finalize', async () => {
    const input: NotifyInput = {
      ...baseInput,
      pipelineStatus: 'skip_to_finalize',
    };

    const result = await notifyStep.execute({ inputData: input });

    expect(result.pipelineStatus).toBe('skip_to_finalize');
    expect(result.deliveryResults).toEqual([]);
  });

  it('preserves errors when skipping', async () => {
    const existingErrors = [{ step: 'tts', message: 'TTS failed' }];

    const input: NotifyInput = {
      ...baseInput,
      errors: existingErrors,
      pipelineStatus: 'skip_to_finalize',
    };

    const result = await notifyStep.execute({ inputData: input });

    expect(result.errors).toEqual(existingErrors);
  });

  it('returns error when digestLink is null', async () => {
    const input: NotifyInput = {
      ...baseInput,
      digestLink: null,
    };

    const result = await notifyStep.execute({ inputData: input });

    expect(result.deliveryResults).toEqual([]);
    expect(result.pipelineStatus).toBe('continue');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      step: 'notify',
      message: 'No digest link available for notification',
    });
  });

  it('returns error when notification config fails to load', async () => {
    mockedLoadNotificationConfig.mockRejectedValueOnce(
      new Error('Invalid JSON'),
    );

    const result = await notifyStep.execute({ inputData: baseInput });

    expect(result.deliveryResults).toEqual([]);
    expect(result.pipelineStatus).toBe('continue');
    expect(result.errors.some((e) => e.message.includes('Failed to load notification config'))).toBe(true);
  });

  it('returns empty results when no channels configured', async () => {
    mockedLoadNotificationConfig.mockResolvedValueOnce({ channels: [] });

    const result = await notifyStep.execute({ inputData: baseInput });

    expect(result.deliveryResults).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.pipelineStatus).toBe('continue');
  });

  it('delivers to configured channels and returns results', async () => {
    mockedLoadNotificationConfig.mockResolvedValueOnce({
      channels: [
        { type: 'webhook', url: 'https://example.com/hook' },
      ],
    });
    mockedAxiosPost.mockResolvedValueOnce({ data: 'ok' } as any);

    const result = await notifyStep.execute({ inputData: baseInput });

    expect(result.deliveryResults).toHaveLength(1);
    expect(result.deliveryResults[0].channel).toBe('webhook');
    expect(result.deliveryResults[0].success).toBe(true);
    expect(result.pipelineStatus).toBe('continue');
  });

  it('logs per-channel failures as step errors', async () => {
    mockedLoadNotificationConfig.mockResolvedValueOnce({
      channels: [
        { type: 'webhook', url: 'https://example.com/hook' },
        { type: 'discord', webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
      ],
    });
    mockedAxiosPost
      .mockRejectedValueOnce(new Error('Webhook down'))
      .mockResolvedValueOnce({ data: 'ok' } as any);

    const result = await notifyStep.execute({ inputData: baseInput });

    expect(result.deliveryResults).toHaveLength(2);
    expect(result.deliveryResults[0].success).toBe(false);
    expect(result.deliveryResults[1].success).toBe(true);

    // Failed channel should be logged as a step error
    expect(result.errors.some((e) => e.step === 'notify' && e.message.includes('webhook'))).toBe(true);
  });

  it('preserves existing errors alongside new notification errors', async () => {
    const existingErrors = [{ step: 'tts', message: 'TTS rate limited' }];

    mockedLoadNotificationConfig.mockResolvedValueOnce({
      channels: [
        { type: 'webhook', url: 'https://example.com/hook' },
      ],
    });
    mockedAxiosPost.mockRejectedValueOnce(new Error('Webhook down'));

    const input: NotifyInput = {
      ...baseInput,
      errors: existingErrors,
    };

    const result = await notifyStep.execute({ inputData: input });

    // Should have the existing error plus the new notification error
    expect(result.errors.length).toBeGreaterThan(1);
    expect(result.errors[0]).toEqual(existingErrors[0]);
    expect(result.errors.some((e) => e.step === 'notify')).toBe(true);
  });
});
