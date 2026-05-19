import { z } from 'zod';

export const SMTPConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean(),
  auth: z.object({
    user: z.string().min(1),
    pass: z.string().min(1),
  }),
});

const WebhookChannelSchema = z.object({
  type: z.literal('webhook'),
  url: z.string().url(),
});

const DiscordChannelSchema = z.object({
  type: z.literal('discord'),
  webhookUrl: z.string().url(),
});

const EmailChannelSchema = z.object({
  type: z.literal('email'),
  smtp: SMTPConfigSchema,
  to: z.string().min(1),
});

export const NotificationChannelSchema = z.discriminatedUnion('type', [
  WebhookChannelSchema,
  DiscordChannelSchema,
  EmailChannelSchema,
]);

export const NotificationConfigurationSchema = z.object({
  channels: z.array(NotificationChannelSchema),
});

export type SMTPConfig = z.infer<typeof SMTPConfigSchema>;
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
export type NotificationConfiguration = z.infer<typeof NotificationConfigurationSchema>;
