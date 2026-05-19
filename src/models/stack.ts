import { z } from 'zod';

export const StackLibrarySchema = z.object({
  name: z.string().min(1),
  urls: z.array(z.string().url()).min(1),
  added_at: z.string().datetime(),
});

export const StackConfigurationSchema = z.object({
  libraries: z.array(StackLibrarySchema),
});

export type StackLibrary = z.infer<typeof StackLibrarySchema>;
export type StackConfiguration = z.infer<typeof StackConfigurationSchema>;
