import { z } from 'zod';

export const DigestResponseSchema = z.object({
  run_id: z.string().uuid(),
  briefing_script: z.string(),
  audio_url: z.string().url().nullable(),
  generated_at: z.string().datetime(),
});

export type DigestResponse = z.infer<typeof DigestResponseSchema>;
