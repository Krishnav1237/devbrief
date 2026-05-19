import { z } from 'zod';

export const ChangeClassificationSchema = z.enum([
  'breaking',
  'deprecation',
  'feature',
  'patch',
]);

export const ChangeEntrySchema = z.object({
  entry_id: z.string().uuid(),
  run_id: z.string().uuid(),
  library_name: z.string().min(1),
  version: z.string().min(1),
  source_url: z.string().url(),
  raw_content: z.string(),
  classification: ChangeClassificationSchema.nullable(),
  summary: z.string().nullable(),
  confidence_flag: z.boolean(),
  scraped_at: z.string().datetime(),
});

export type ChangeClassification = z.infer<typeof ChangeClassificationSchema>;
export type ChangeEntry = z.infer<typeof ChangeEntrySchema>;
