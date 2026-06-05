import { z } from 'zod';
import {
  StepErrorSchema,
  type StepError,
} from '../models/index.js';
import {
  ClassifiedChangeEntrySchema,
  type ClassifiedChangeEntry,
} from './summarize.js';
import { detectTailscaleIP } from '../utils/network.js';

// ---------------------------------------------------------------------------
// Zod schemas for step I/O
// ---------------------------------------------------------------------------

const PipelineStatusSchema = z.enum(['continue', 'skip_to_finalize']);
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

export const PublishInputSchema = z.object({
  briefingScript: z.string().nullable(),
  audioUrl: z.string().nullable(),
  ttsFailed: z.boolean(),
  classifiedEntries: z.array(ClassifiedChangeEntrySchema),
  errors: z.array(StepErrorSchema),
  runId: z.string().uuid(),
  pipelineStatus: PipelineStatusSchema.optional(),
});
export type PublishInput = z.infer<typeof PublishInputSchema>;

export const PublishOutputSchema = z.object({
  digestLink: z.string().nullable(),
  briefingScript: z.string().nullable(),
  audioUrl: z.string().nullable(),
  classifiedEntries: z.array(ClassifiedChangeEntrySchema),
  errors: z.array(StepErrorSchema),
  pipelineStatus: PipelineStatusSchema,
});
export type PublishOutput = z.infer<typeof PublishOutputSchema>;

// ---------------------------------------------------------------------------
// Pure helpers (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Builds a local digest URL using the Tailscale IP and port.
 * Falls back to `localhost` if TAILSCALE_IP is not set.
 */
export function buildDigestUrl(
  runId: string,
  tailscaleIp?: string,
  port?: string,
): string {
  const host = tailscaleIp || 'localhost';
  const p = port || '7890';
  return `http://${host}:${p}/digest/${runId}`;
}

// ---------------------------------------------------------------------------
// Mastra step definition
// ---------------------------------------------------------------------------

/**
 * The publish step: generates a shareable Digest_Link for the briefing.
 *
 * Since Paperclip's API surface hasn't been validated, the local fallback
 * is the primary path. The step generates a Tailscale-accessible URL
 * pointing to the `/digest/:run_id` endpoint served by the HTTP server.
 *
 * Note: Uses manual pipelineStatus checking for now. Will be refactored to
 * use createSkippableStep() wrapper in Task 13.1.
 */
export const publishStep = {
  id: 'publish' as const,
  description: 'Publish digest and generate shareable link',
  inputSchema: PublishInputSchema,
  outputSchema: PublishOutputSchema,

  execute: async ({
    inputData,
  }: {
    inputData: PublishInput;
  }): Promise<PublishOutput> => {
    const {
      briefingScript,
      audioUrl,
      ttsFailed,
      classifiedEntries,
      errors,
      runId,
      pipelineStatus,
    } = inputData;

    // Early-exit propagation (manual check — will be handled by createSkippableStep in Task 13.1)
    if (pipelineStatus === 'skip_to_finalize') {
      return {
        digestLink: null,
        briefingScript: briefingScript ?? null,
        audioUrl: audioUrl ?? null,
        classifiedEntries: classifiedEntries ?? [],
        errors: errors ?? [],
        pipelineStatus: 'skip_to_finalize',
      };
    }

    // If no briefing script, nothing to publish
    if (!briefingScript) {
      return {
        digestLink: null,
        briefingScript: null,
        audioUrl: audioUrl ?? null,
        classifiedEntries: classifiedEntries ?? [],
        errors: [
          ...(errors ?? []),
          { step: 'publish', message: 'No briefing script available for publishing' },
        ],
        pipelineStatus: 'continue',
      };
    }

    // Build the local digest URL (primary path — Paperclip not validated)
    const tailscaleIp = process.env.TAILSCALE_IP || detectTailscaleIP() || undefined;
    const port = process.env.DEVBRIEF_PORT;
    const digestLink = buildDigestUrl(runId, tailscaleIp, port);

    if (ttsFailed) {
      console.log(`[publish] Publishing text-only digest (TTS failed): ${digestLink}`);
    } else {
      console.log(`[publish] Publishing digest with audio: ${digestLink}`);
    }

    return {
      digestLink,
      briefingScript,
      audioUrl: audioUrl ?? null,
      classifiedEntries: classifiedEntries ?? [],
      errors: errors ?? [],
      pipelineStatus: 'continue',
    };
  },
};
