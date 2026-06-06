/**
 * DevBrief pipeline workflow — Mastra integration.
 *
 * Defines the pipeline as a proper Mastra workflow using createWorkflow/createStep
 * from @mastra/core/workflows. Each step wraps the existing step logic functions.
 *
 * Uses a unified "pipeline state" schema that flows through all steps.
 * Each step receives the full state and returns the updated state.
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import {
  ChangeEntrySchema,
  StepErrorSchema,
  type RunRecord,
  type RunStatus,
} from '../../models/index.js';
import { loadStackConfig } from '../../utils/config-io.js';
import { purgeOldEntries } from '../../utils/purge.js';
import {
  initStore,
  storeRunRecord,
  updateRunRecord,
} from '../../utils/store.js';
import { getHydraDBClient } from '../../utils/hydradb.js';

// Step logic imports
import { scrapeStep as scrapeLogic } from '../../steps/scrape.js';
import { deduplicateStep as deduplicateLogic } from '../../steps/deduplicate.js';
import { summarizeStep as summarizeLogic } from '../../steps/summarize.js';
import { generateScriptStep as generateScriptLogic } from '../../steps/generate-script.js';
import { ttsStep as ttsLogic } from '../../steps/tts.js';
import { publishStep as publishLogic } from '../../steps/publish.js';
import { notifyStep as notifyLogic } from '../../steps/notify.js';
import { ClassifiedChangeEntrySchema } from '../../steps/summarize.js';

import type { TriggerType } from '../../cli/run-pipeline.js';

// ---------------------------------------------------------------------------
// Pipeline state schema — flows through all steps
// ---------------------------------------------------------------------------

const PipelineStatusSchema = z.enum(['continue', 'skip_to_finalize']);

export const PipelineStateSchema = z.object({
  runId: z.string().uuid(),
  triggerType: z.enum(['manual', 'cron', 'webhook']),
  triggeredAt: z.string(),
  librariesProcessed: z.array(z.string()),
  entries: z.array(ChangeEntrySchema),
  newEntries: z.array(ChangeEntrySchema),
  classifiedEntries: z.array(ClassifiedChangeEntrySchema),
  duplicateCount: z.number().int().nonnegative(),
  briefingScript: z.string().nullable(),
  audioUrl: z.string().nullable(),
  digestLink: z.string().nullable(),
  errors: z.array(StepErrorSchema),
  pipelineStatus: PipelineStatusSchema,
  terminalStatus: z.enum([
    'in_progress',
    'completed',
    'no_new_changes',
    'no_stack_configured',
    'llm_failed',
  ]),
  newChangeCount: z.number().int().nonnegative(),
});

export type PipelineState = z.infer<typeof PipelineStateSchema>;

// ---------------------------------------------------------------------------
// Step 1: Init Run — creates run record, purges old data, loads stack
// ---------------------------------------------------------------------------

export const initRunStep = createStep({
  id: 'init-run',
  description: 'Initialize pipeline run, purge old data, load stack configuration',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
  execute: async ({ inputData }) => {
    const state = { ...inputData };

    // Initialize the store (idempotent)
    initStore();

    // Create run record
    const runRecord: RunRecord = {
      run_id: state.runId,
      triggered_at: state.triggeredAt,
      trigger_type: state.triggerType,
      status: 'in_progress',
      has_errors: false,
      libraries_processed: [],
      new_change_count: 0,
      briefing_script: null,
      audio_url: null,
      digest_link: null,
      errors: [],
      completed_at: null,
    };
    storeRunRecord(runRecord);
    console.log(`[pipeline] Run ${state.runId} started (trigger: ${state.triggerType})`);

    // Purge old entries
    try {
      const purgeResult = purgeOldEntries();
      if (purgeResult.purgedEntries > 0 || purgeResult.purgedRuns > 0) {
        console.log(
          `[pipeline] Purged ${purgeResult.purgedEntries} old entries and ${purgeResult.purgedRuns} old run records`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[pipeline] Purge failed (non-fatal): ${message}`);
    }

    // Load stack configuration
    const stackConfig = await loadStackConfig();

    if (stackConfig.libraries.length === 0) {
      console.warn(
        '[pipeline] No libraries configured. Run `devbrief stack add` to add libraries to monitor.',
      );
      state.pipelineStatus = 'skip_to_finalize';
      state.terminalStatus = 'no_stack_configured';
      return state;
    }

    state.librariesProcessed = stackConfig.libraries.map((lib) => lib.name);

    // Store libraries in entries for scrape step (pass via state)
    // We'll use a workaround: store the libraries JSON in a temporary field
    // Actually, the scrape step needs the full library objects. We'll call it directly.
    const scrapeOutput = await scrapeLogic.execute({
      inputData: {
        libraries: stackConfig.libraries,
        runId: state.runId,
        pipelineStatus: state.pipelineStatus === 'skip_to_finalize' ? 'skip_to_finalize' : undefined,
      },
    });

    state.entries = scrapeOutput.entries;
    state.errors = scrapeOutput.errors;
    state.pipelineStatus = scrapeOutput.pipelineStatus;

    return state;
  },
});

// ---------------------------------------------------------------------------
// Step 2: Deduplicate
// ---------------------------------------------------------------------------

export const deduplicateStep = createStep({
  id: 'deduplicate',
  description: 'Filter scraped entries against stored data to find new changes',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
  execute: async ({ inputData }) => {
    const state = { ...inputData };

    if (state.pipelineStatus === 'skip_to_finalize') {
      return state;
    }

    // Query HydraDB for additional dedup data
    const hydraClient = getHydraDBClient();
    const entriesToDeduplicate = [];
    let hydraDuplicateCount = 0;

    if (hydraClient) {
      for (const entry of state.entries) {
        if (entry.version !== 'unknown') {
          const exists = await hydraClient.entryExists(entry.library_name, entry.version);
          if (exists) {
            console.log(
              `[deduplicate] HydraDB: entry ${entry.library_name}@${entry.version} already exists`,
            );
            hydraDuplicateCount++;
            continue;
          }
        }
        entriesToDeduplicate.push(entry);
      }
    } else {
      entriesToDeduplicate.push(...state.entries);
    }

    const deduplicateOutput = await deduplicateLogic.execute({
      inputData: {
        entries: entriesToDeduplicate,
        errors: state.errors,
        runId: state.runId,
      },
    });

    state.newEntries = deduplicateOutput.newEntries;
    state.duplicateCount = deduplicateOutput.duplicateCount + hydraDuplicateCount;
    state.errors = deduplicateOutput.errors;
    state.pipelineStatus = deduplicateOutput.pipelineStatus;
    state.newChangeCount = deduplicateOutput.newEntries.length;

    if (state.pipelineStatus === 'skip_to_finalize' && deduplicateOutput.newEntries.length === 0) {
      state.terminalStatus = 'no_new_changes';
    }

    return state;
  },
});

// ---------------------------------------------------------------------------
// Step 3: Summarize (classify + summarize via LLM)
// ---------------------------------------------------------------------------

export const summarizeStep = createStep({
  id: 'summarize',
  description: 'Classify and summarize change entries using LLM',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
  execute: async ({ inputData }) => {
    const state = { ...inputData };

    if (state.pipelineStatus === 'skip_to_finalize') {
      return state;
    }

    const summarizeOutput = await summarizeLogic.execute({
      inputData: {
        newEntries: state.newEntries,
        errors: state.errors,
        duplicateCount: state.duplicateCount,
        runId: state.runId,
      },
    });

    state.classifiedEntries = summarizeOutput.classifiedEntries;
    state.errors = summarizeOutput.errors;
    state.pipelineStatus = summarizeOutput.pipelineStatus;

    // If summarize set skip_to_finalize (LLM failure), mark as llm_failed
    if (
      state.pipelineStatus === 'skip_to_finalize' &&
      state.terminalStatus === 'in_progress' &&
      summarizeOutput.classifiedEntries.length === 0 &&
      state.newEntries.length > 0
    ) {
      state.terminalStatus = 'llm_failed';
    }

    // Store classified entries in HydraDB
    const hydraClient = getHydraDBClient();
    if (hydraClient && summarizeOutput.classifiedEntries.length > 0) {
      console.log(
        `[summarize] Storing ${summarizeOutput.classifiedEntries.length} classified entries in HydraDB`,
      );
      await hydraClient.storeChangeEntries(summarizeOutput.classifiedEntries);
    }

    return state;
  },
});

// ---------------------------------------------------------------------------
// Step 4: Generate Script
// ---------------------------------------------------------------------------

export const generateScriptStep = createStep({
  id: 'generate-script',
  description: 'Generate briefing script from classified entries',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
  execute: async ({ inputData }) => {
    const state = { ...inputData };

    if (state.pipelineStatus === 'skip_to_finalize') {
      return state;
    }

    const generateScriptOutput = await generateScriptLogic.execute({
      inputData: {
        classifiedEntries: state.classifiedEntries,
        errors: state.errors,
      },
    });

    state.briefingScript = generateScriptOutput.briefingScript;
    state.errors = generateScriptOutput.errors;
    state.pipelineStatus = generateScriptOutput.pipelineStatus;

    return state;
  },
});

// ---------------------------------------------------------------------------
// Step 5: TTS
// ---------------------------------------------------------------------------

export const ttsStep = createStep({
  id: 'tts',
  description: 'Convert briefing script to audio via Sarvam AI TTS',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
  execute: async ({ inputData }) => {
    const state = { ...inputData };

    if (state.pipelineStatus === 'skip_to_finalize') {
      return state;
    }

    const ttsOutput = await ttsLogic.execute({
      inputData: {
        briefingScript: state.briefingScript,
        classifiedEntries: state.classifiedEntries,
        errors: state.errors,
        runId: state.runId,
      },
    });

    state.audioUrl = ttsOutput.audioUrl;
    state.errors = ttsOutput.errors;
    state.pipelineStatus = ttsOutput.pipelineStatus;

    return state;
  },
});

// ---------------------------------------------------------------------------
// Step 6: Publish
// ---------------------------------------------------------------------------

export const publishStep = createStep({
  id: 'publish',
  description: 'Publish digest and generate shareable link',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
  execute: async ({ inputData }) => {
    const state = { ...inputData };

    if (state.pipelineStatus === 'skip_to_finalize') {
      return state;
    }

    const publishOutput = await publishLogic.execute({
      inputData: {
        briefingScript: state.briefingScript,
        audioUrl: state.audioUrl,
        ttsFailed: state.audioUrl === null,
        classifiedEntries: state.classifiedEntries,
        errors: state.errors,
        runId: state.runId,
      },
    });

    state.digestLink = publishOutput.digestLink;
    state.errors = publishOutput.errors;
    state.pipelineStatus = publishOutput.pipelineStatus;

    return state;
  },
});

// ---------------------------------------------------------------------------
// Step 7: Notify
// ---------------------------------------------------------------------------

export const notifyStep = createStep({
  id: 'notify',
  description: 'Deliver notifications to configured channels',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
  execute: async ({ inputData }) => {
    const state = { ...inputData };

    if (state.pipelineStatus === 'skip_to_finalize') {
      return state;
    }

    const notifyOutput = await notifyLogic.execute({
      inputData: {
        digestLink: state.digestLink,
        briefingScript: state.briefingScript,
        audioUrl: state.audioUrl,
        classifiedEntries: state.classifiedEntries,
        errors: state.errors,
        runId: state.runId,
      },
    });

    state.errors = notifyOutput.errors;

    return state;
  },
});

// ---------------------------------------------------------------------------
// Step 8: Finalize Run
// ---------------------------------------------------------------------------

export const finalizeRunStep = createStep({
  id: 'finalize-run',
  description: 'Finalize the run record with results',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
  execute: async ({ inputData }) => {
    const state = { ...inputData };

    // Determine final terminal status
    const terminalStatus: RunStatus =
      state.terminalStatus === 'in_progress' ? 'completed' : state.terminalStatus;

    // Update run record
    const runRecord: RunRecord = {
      run_id: state.runId,
      triggered_at: state.triggeredAt,
      trigger_type: state.triggerType,
      status: terminalStatus,
      has_errors: state.errors.length > 0,
      libraries_processed: state.librariesProcessed,
      new_change_count: state.newChangeCount,
      briefing_script: state.briefingScript,
      audio_url: state.audioUrl,
      digest_link: state.digestLink,
      errors: state.errors,
      completed_at: new Date().toISOString(),
    };

    updateRunRecord(runRecord);
    console.log(
      `[pipeline] Run ${state.runId} finalized: status=${terminalStatus}, errors=${state.errors.length}`,
    );

    // Store run summary in HydraDB
    const hydraClient = getHydraDBClient();
    if (hydraClient && state.briefingScript) {
      await hydraClient.storeRunSummary(state.runId, state.briefingScript, {
        trigger_type: state.triggerType,
        status: terminalStatus,
        libraries_processed: state.librariesProcessed,
        new_change_count: state.newChangeCount,
        completed_at: runRecord.completed_at,
      });
    }

    state.terminalStatus = terminalStatus;

    return state;
  },
});

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

export const devbriefPipeline = createWorkflow({
  id: 'devbrief-pipeline',
  inputSchema: PipelineStateSchema,
  outputSchema: PipelineStateSchema,
})
  .then(initRunStep)
  .then(deduplicateStep)
  .then(summarizeStep)
  .then(generateScriptStep)
  .then(ttsStep)
  .then(publishStep)
  .then(notifyStep)
  .then(finalizeRunStep)
  .commit();

// ---------------------------------------------------------------------------
// Helper: create initial pipeline state
// ---------------------------------------------------------------------------

export function createInitialPipelineState(triggerType: TriggerType, runId?: string): PipelineState {
  return {
    runId: runId ?? uuidv4(),
    triggerType,
    triggeredAt: new Date().toISOString(),
    librariesProcessed: [],
    entries: [],
    newEntries: [],
    classifiedEntries: [],
    duplicateCount: 0,
    briefingScript: null,
    audioUrl: null,
    digestLink: null,
    errors: [],
    pipelineStatus: 'continue',
    terminalStatus: 'in_progress',
    newChangeCount: 0,
  };
}
