import { z } from 'zod';

export const DigestResponseSchema = z.object({
  run_id: z.string().uuid(),
  briefing_script: z.string(),
  audio_url: z.string().url().nullable(),
  generated_at: z.string().datetime(),
  criticalCount: z.number().int().nonnegative().optional(),
  breakingCount: z.number().int().nonnegative().optional(),
  minorCount: z.number().int().nonnegative().optional(),
});

export type DigestResponse = z.infer<typeof DigestResponseSchema>;
