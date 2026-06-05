import { z } from 'zod';

export const RunStatusSchema = z.enum([
  'in_progress',
  'completed',
  'no_new_changes',
  'no_stack_configured',
  'llm_failed',
]);

export const StepErrorSchema = z.object({
  step: z.string(),
  library_name: z.string().optional(),
  message: z.string(),
});

export const RunRecordSchema = z.object({
  run_id: z.string().uuid(),
  triggered_at: z.string().datetime(),
  trigger_type: z.enum(['cron', 'webhook', 'manual']),
  status: RunStatusSchema,
  has_errors: z.boolean(),
  libraries_processed: z.array(z.string()),
  new_change_count: z.number().int().nonnegative(),
  briefing_script: z.string().nullable(),
  audio_url: z.string().nullable(),
  digest_link: z.string().nullable(),
  errors: z.array(StepErrorSchema),
  completed_at: z.string().datetime().nullable(),
  criticalCount: z.number().int().nonnegative().optional(),
  breakingCount: z.number().int().nonnegative().optional(),
  minorCount: z.number().int().nonnegative().optional(),
});

export type RunStatus = z.infer<typeof RunStatusSchema>;
export type StepError = z.infer<typeof StepErrorSchema>;
export type RunRecord = z.infer<typeof RunRecordSchema>;
