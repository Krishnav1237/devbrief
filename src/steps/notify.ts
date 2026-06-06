import { z } from 'zod';
import axios from 'axios';
import nodemailer from 'nodemailer';
import {
  StepErrorSchema,
  type StepError,
  type NotificationChannel,
  type SMTPConfig,
} from '../models/index.js';
import { loadNotificationConfig } from '../utils/config-io.js';
import {
  ClassifiedChangeEntrySchema,
} from './summarize.js';

// ---------------------------------------------------------------------------
// Zod schemas for step I/O
// ---------------------------------------------------------------------------

const PipelineStatusSchema = z.enum(['continue', 'skip_to_finalize']);
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

export const DeliveryResultSchema = z.object({
  channel: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
});
export type DeliveryResult = z.infer<typeof DeliveryResultSchema>;

export const NotifyInputSchema = z.object({
  digestLink: z.string().nullable(),
  briefingScript: z.string().nullable(),
  audioUrl: z.string().nullable(),
  classifiedEntries: z.array(ClassifiedChangeEntrySchema),
  errors: z.array(StepErrorSchema),
  runId: z.string().uuid(),
  pipelineStatus: PipelineStatusSchema.optional(),
});
export type NotifyInput = z.infer<typeof NotifyInputSchema>;

export const NotifyOutputSchema = z.object({
  deliveryResults: z.array(DeliveryResultSchema),
  errors: z.array(StepErrorSchema),
  pipelineStatus: PipelineStatusSchema,
});
export type NotifyOutput = z.infer<typeof NotifyOutputSchema>;

// ---------------------------------------------------------------------------
// Channel delivery functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Sends a webhook notification by POSTing a JSON body with the digest link
 * and run ID to the configured URL.
 */
export async function sendWebhook(
  url: string,
  digestLink: string,
  runId?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await axios.post(url, {
      digest_link: digestLink,
      run_id: runId ?? null,
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Webhook delivery failed: ${message}` };
  }
}

/**
 * Sends a Discord notification by POSTing a formatted embed message
 * to the configured Discord webhook URL.
 */
export async function sendDiscord(
  webhookUrl: string,
  digestLink: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await axios.post(webhookUrl, {
      embeds: [
        {
          title: '📋 DevBrief Daily Digest',
          description: `Your daily developer briefing is ready!\n\n[View Digest](${digestLink})`,
          color: 0x5865f2, // Discord blurple
          footer: {
            text: 'DevBrief',
          },
          timestamp: new Date().toISOString(),
        },
      ],
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Discord delivery failed: ${message}` };
  }
}

/**
 * Sends an email notification via SMTP using nodemailer with the configured
 * credentials and a simple HTML template containing the digest link.
 */
export async function sendEmail(
  smtp: SMTPConfig,
  to: string,
  digestLink: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.auth.user,
        pass: smtp.auth.pass,
      },
    });

    await transporter.sendMail({
      from: smtp.auth.user,
      to,
      subject: 'DevBrief Daily Digest',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>📋 DevBrief Daily Digest</h2>
          <p>Your daily developer briefing is ready!</p>
          <p><a href="${digestLink}" style="display: inline-block; padding: 10px 20px; background-color: #5865f2; color: white; text-decoration: none; border-radius: 4px;">View Digest</a></p>
          <p style="color: #666; font-size: 12px;">Sent by DevBrief</p>
        </div>
      `,
    });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Email delivery failed: ${message}` };
  }
}

/**
 * Delivers notifications to all configured channels. Attempts every channel
 * regardless of individual failures, returning per-channel results.
 */
export async function deliverNotifications(
  channels: NotificationChannel[],
  digestLink: string,
  runId?: string,
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];

  for (const channel of channels) {
    switch (channel.type) {
      case 'webhook': {
        const result = await sendWebhook(channel.url, digestLink, runId);
        results.push({ channel: 'webhook', ...result });
        break;
      }
      case 'discord': {
        const result = await sendDiscord(channel.webhookUrl, digestLink);
        results.push({ channel: 'discord', ...result });
        break;
      }
      case 'email': {
        const result = await sendEmail(channel.smtp, channel.to, digestLink);
        results.push({ channel: 'email', ...result });
        break;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Mastra step definition
// ---------------------------------------------------------------------------

/**
 * The notify step: delivers the Digest_Link to all configured notification
 * channels (webhook, Discord, email).
 *
 * Note: Uses manual pipelineStatus checking for now. Will be refactored to
 * use createSkippableStep() wrapper in Task 13.1.
 */
export const notifyStep = {
  id: 'notify' as const,
  description: 'Deliver notifications to configured channels',
  inputSchema: NotifyInputSchema,
  outputSchema: NotifyOutputSchema,

  execute: async ({
    inputData,
  }: {
    inputData: NotifyInput;
  }): Promise<NotifyOutput> => {
    const { digestLink, errors, runId, pipelineStatus } = inputData;

    // Early-exit propagation (manual check — will be handled by createSkippableStep in Task 13.1)
    if (pipelineStatus === 'skip_to_finalize') {
      return {
        deliveryResults: [],
        errors: errors ?? [],
        pipelineStatus: 'skip_to_finalize',
      };
    }

    // If no digest link, nothing to notify about
    if (!digestLink) {
      return {
        deliveryResults: [],
        errors: [
          ...(errors ?? []),
          { step: 'notify', message: 'No digest link available for notification' },
        ],
        pipelineStatus: 'continue',
      };
    }

    // Load notification configuration
    let channels: NotificationChannel[];
    try {
      const config = await loadNotificationConfig();
      channels = config.channels;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[notify] Failed to load notification config: ${message}`);
      return {
        deliveryResults: [],
        errors: [
          ...(errors ?? []),
          { step: 'notify', message: `Failed to load notification config: ${message}` },
        ],
        pipelineStatus: 'continue',
      };
    }

    // If no channels configured, log and continue
    if (channels.length === 0) {
      console.log('[notify] No notification channels configured, skipping.');
      return {
        deliveryResults: [],
        errors: errors ?? [],
        pipelineStatus: 'continue',
      };
    }

    // Deliver to all channels
    const deliveryResults = await deliverNotifications(channels, digestLink, runId);

    // Log per-channel results
    const stepErrors: StepError[] = [...(errors ?? [])];
    for (const result of deliveryResults) {
      if (result.success) {
        console.log(`[notify] ${result.channel}: delivered successfully`);
      } else {
        console.warn(`[notify] ${result.channel}: ${result.error}`);
        stepErrors.push({
          step: 'notify',
          message: `${result.channel}: ${result.error}`,
        });
      }
    }

    console.log(
      `[notify] Delivered to ${deliveryResults.filter((r) => r.success).length}/${deliveryResults.length} channels`,
    );

    return {
      deliveryResults,
      errors: stepErrors,
      pipelineStatus: 'continue',
    };
  },
};
