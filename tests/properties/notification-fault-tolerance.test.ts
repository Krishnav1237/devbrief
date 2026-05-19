// Feature: devbrief, Property 14: Notification channel fault tolerance
// **Validates: Requirements 9.4**

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { deliverNotifications } from '../../src/steps/notify.js';
import type { NotificationChannel } from '../../src/models/index.js';

// ---------------------------------------------------------------------------
// Mock axios and nodemailer
// ---------------------------------------------------------------------------

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

vi.mock('nodemailer', () => {
  const sendMailMock = vi.fn();
  return {
    default: {
      createTransport: vi.fn().mockReturnValue({
        sendMail: sendMailMock,
      }),
    },
    __sendMailMock: sendMailMock,
  };
});

import axios from 'axios';
import nodemailer from 'nodemailer';

const mockedAxiosPost = vi.mocked(axios.post);

// ---------------------------------------------------------------------------
// Types for test generation
// ---------------------------------------------------------------------------

interface ChannelSpec {
  channel: NotificationChannel;
  shouldSucceed: boolean;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Arbitrary webhook channel with success/failure outcome */
const arbWebhookSpec: fc.Arbitrary<ChannelSpec> = fc
  .tuple(
    fc.webUrl({ withFragments: false, withQueryParameters: false }),
    fc.boolean(),
  )
  .map(([url, shouldSucceed]) => ({
    channel: { type: 'webhook' as const, url },
    shouldSucceed,
  }));

/** Arbitrary discord channel with success/failure outcome */
const arbDiscordSpec: fc.Arbitrary<ChannelSpec> = fc
  .tuple(
    fc.webUrl({ withFragments: false, withQueryParameters: false }),
    fc.boolean(),
  )
  .map(([webhookUrl, shouldSucceed]) => ({
    channel: { type: 'discord' as const, webhookUrl },
    shouldSucceed,
  }));

/** Arbitrary email channel with success/failure outcome */
const arbEmailSpec: fc.Arbitrary<ChannelSpec> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.integer({ min: 1, max: 65535 }),
    fc.boolean(),
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.string({ minLength: 1, maxLength: 30 }),
    fc.boolean(),
  )
  .map(([host, port, secure, user, pass, to, shouldSucceed]) => ({
    channel: {
      type: 'email' as const,
      smtp: { host, port, secure, auth: { user, pass } },
      to,
    },
    shouldSucceed,
  }));

/** Arbitrary channel spec (any type) */
const arbChannelSpec: fc.Arbitrary<ChannelSpec> = fc.oneof(
  arbWebhookSpec,
  arbDiscordSpec,
  arbEmailSpec,
);

/** Non-empty array of channel specs */
const arbChannelSpecs = fc.array(arbChannelSpec, { minLength: 1, maxLength: 8 });

/** Arbitrary digest link */
const arbDigestLink = fc
  .webUrl({ withFragments: false, withQueryParameters: false })
  .filter((url) => url.length > 0);

/** Arbitrary run ID */
const arbRunId = fc.uuid();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Configure mocks so that each channel call succeeds or fails
 * according to the spec. We track the call index for axios.post
 * (used by webhook and discord) and configure nodemailer per email call.
 */
function configureMocks(specs: ChannelSpec[]): void {
  // Count how many axios calls (webhook + discord) and email calls we expect
  let axiosCallIndex = 0;
  const emailSpecs: ChannelSpec[] = [];

  for (const spec of specs) {
    if (spec.channel.type === 'webhook' || spec.channel.type === 'discord') {
      if (spec.shouldSucceed) {
        mockedAxiosPost.mockResolvedValueOnce({ data: 'ok' } as any);
      } else {
        mockedAxiosPost.mockRejectedValueOnce(new Error(`${spec.channel.type} delivery error`));
      }
      axiosCallIndex++;
    } else if (spec.channel.type === 'email') {
      emailSpecs.push(spec);
    }
  }

  // For email channels, configure nodemailer mock per call
  for (const emailSpec of emailSpecs) {
    const sendMailMock = emailSpec.shouldSucceed
      ? vi.fn().mockResolvedValueOnce({ messageId: 'test-id' })
      : vi.fn().mockRejectedValueOnce(new Error('email delivery error'));

    vi.mocked(nodemailer.createTransport).mockReturnValueOnce({
      sendMail: sendMailMock,
    } as any);
  }
}

// ---------------------------------------------------------------------------
// Property 14: Notification channel fault tolerance
// ---------------------------------------------------------------------------

describe('Property 14: Notification channel fault tolerance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('for any set of channels with arbitrary success/failure outcomes, deliverNotifications returns one result per channel, attempts all channels, and correctly reflects per-channel success/failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbChannelSpecs,
        arbDigestLink,
        arbRunId,
        async (specs, digestLink, runId) => {
          vi.clearAllMocks();

          // Configure mocks based on expected outcomes
          configureMocks(specs);

          const channels = specs.map((s) => s.channel);
          const results = await deliverNotifications(channels, digestLink, runId);

          // (a) deliverNotifications returns exactly one result per channel
          expect(results).toHaveLength(specs.length);

          // (b) All channels are attempted regardless of failures
          // Verify by checking that each result has the correct channel type
          for (let i = 0; i < specs.length; i++) {
            expect(results[i].channel).toBe(specs[i].channel.type);
          }

          // (c) Per-channel results correctly reflect success/failure
          for (let i = 0; i < specs.length; i++) {
            if (specs[i].shouldSucceed) {
              expect(results[i].success).toBe(true);
              expect(results[i].error).toBeUndefined();
            } else {
              expect(results[i].success).toBe(false);
              expect(results[i].error).toBeDefined();
              expect(typeof results[i].error).toBe('string');
              expect(results[i].error!.length).toBeGreaterThan(0);
            }
          }

          // Additional: verify total attempted count equals total channels
          // (no channel was skipped due to a prior failure)
          const totalAxiosCalls = specs.filter(
            (s) => s.channel.type === 'webhook' || s.channel.type === 'discord',
          ).length;
          const totalEmailCalls = specs.filter(
            (s) => s.channel.type === 'email',
          ).length;

          expect(mockedAxiosPost).toHaveBeenCalledTimes(totalAxiosCalls);
          expect(nodemailer.createTransport).toHaveBeenCalledTimes(totalEmailCalls);
        },
      ),
      { numRuns: 100 },
    );
  });
});
