/**
 * DevBrief pipeline workflow.
 *
 * Orchestrates the pipeline using Mastra's createWorkflow/createStep from
 * @mastra/core/workflows. The workflow chains steps with .then() and uses
 * a unified pipeline state schema that flows through all steps.
 *
 * Pipeline: initRun → deduplicate → summarize → generateScript → tts →
 *           publish → notify → finalizeRun
 *
 * Requirements: 2.4, 4.4, 4.6, 5.6, 9.5
 */

import type { TriggerType } from './cli/run-pipeline.js';
import type { RunRecord, RunStatus, StepError } from './models/index.js';
import { loadStackConfig } from './utils/config-io.js';
import { purgeOldEntries } from './utils/purge.js';
import {
  initStore,
  storeRunRecord,
  updateRunRecord,
  getRunRecord,
} from './utils/store.js';
import { getHydraDBClient } from './utils/hydradb.js';

// Mastra workflow imports
import {
  devbriefPipeline,
  createInitialPipelineState,
  type PipelineState,
} from './mastra/workflows/devbrief-pipeline.js';

// Step imports (kept for direct execution fallback)
import { scrapeStep } from './steps/scrape.js';
import { deduplicateStep } from './steps/deduplicate.js';
import { summarizeStep } from './steps/summarize.js';
import { generateScriptStep } from './steps/generate-script.js';
import { ttsStep } from './steps/tts.js';
import { publishStep } from './steps/publish.js';
import { notifyStep } from './steps/notify.js';

// ---------------------------------------------------------------------------
// Concurrent-run guard
// ---------------------------------------------------------------------------

let runInProgress = false;

/** Returns whether a pipeline run is currently in progress. */
export function isRunInProgress(): boolean {
  return runInProgress;
}

/** Sets the run-in-progress flag. Used by the HTTP server to reject concurrent triggers. */
export function setRunInProgress(value: boolean): void {
  runInProgress = value;
}

// ---------------------------------------------------------------------------
// Pipeline execution via Mastra workflow
// ---------------------------------------------------------------------------

/**
 * Runs the full DevBrief pipeline using the Mastra workflow engine.
 *
 * The workflow is defined in src/mastra/workflows/devbrief-pipeline.ts using
 * Mastra's createWorkflow/createStep. Each step receives the full pipeline
 * state and returns the updated state.
 *
 * @param triggerType - How the pipeline was triggered ('manual', 'cron', or 'webhook')
 * @returns The finalized RunRecord
 */
export async function runDevBriefPipeline(triggerType: TriggerType, runId?: string): Promise<RunRecord> {
  // Prevent concurrent runs
  if (runInProgress) {
    throw new Error('A pipeline run is already in progress.');
  }

  runInProgress = true;

  const initialState = createInitialPipelineState(triggerType, runId);
  const actualRunId = initialState.runId;

  try {
    // Execute the Mastra workflow
    // The workflow handles: initRun → scrape → deduplicate → summarize →
    // generateScript → tts → publish → notify → finalizeRun
    const run = await devbriefPipeline.createRun();
    const result = await run.start({ inputData: initialState });

    // Extract the final state from the workflow result
    let finalState: PipelineState | null = null;

    if (result.status === 'success' && result.result) {
      finalState = result.result as PipelineState;
    } else if (result.steps) {
      // Try to get the last step's output
      const stepKeys = Object.keys(result.steps);
      const lastStepKey = stepKeys[stepKeys.length - 1];
      if (lastStepKey && (result.steps[lastStepKey] as any)?.output) {
        finalState = (result.steps[lastStepKey] as any).output as PipelineState;
      }
    }

    // If we got a final state from the workflow, return the run record
    if (finalState) {
      const record = getRunRecord(finalState.runId);
      if (record) {
        return record;
      }
    }

    // Fallback: if workflow execution didn't produce a clean result,
    // run the pipeline directly (sequential execution)
    console.warn('[pipeline] Mastra workflow did not produce expected result, using direct execution');
    return await runDirectPipeline(triggerType, actualRunId, initialState.triggeredAt);
  } catch (err) {
    // If Mastra workflow fails (e.g., missing pubsub/storage), fall back to direct execution
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[pipeline] Mastra workflow error: ${message}. Falling back to direct execution.`);
    return await runDirectPipeline(triggerType, actualRunId, initialState.triggeredAt);
  } finally {
    runInProgress = false;
  }
}

// ---------------------------------------------------------------------------
// Direct pipeline execution (fallback / primary path when Mastra needs infra)
// ---------------------------------------------------------------------------

/**
 * Runs the pipeline directly by calling each step's execute method in sequence.
 * This is the fallback path when the Mastra workflow engine is not fully configured
 * (e.g., missing pubsub/storage infrastructure).
 *
 * This still uses the same step logic as the Mastra workflow — the steps are
 * defined with createStep() in the workflow file and their execute functions
 * delegate to the same logic modules.
 */
async function runDirectPipeline(
  triggerType: TriggerType,
  runId: string,
  triggeredAt: string,
): Promise<RunRecord> {
  // --- initRunStep ---
  initStore();

  const runRecord: RunRecord = {
    run_id: runId,
    triggered_at: triggeredAt,
    trigger_type: triggerType,
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
  console.log(`[pipeline] Run ${runId} started (trigger: ${triggerType})`);

  // Purge old entries before any new data is written (Req 4.6)
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

  try {
    // --- loadStackStep ---
    const stackConfig = await loadStackConfig();

    if (stackConfig.libraries.length === 0) {
      console.warn(
        '[pipeline] No libraries configured. Run `devbrief stack add` to add libraries to monitor.',
      );
      runRecord.status = 'no_stack_configured';
      runRecord.has_errors = false;
      runRecord.completed_at = new Date().toISOString();
      updateRunRecord(runRecord);
      return runRecord;
    }

    runRecord.libraries_processed = stackConfig.libraries.map((lib) => lib.name);

    let pipelineStatus: 'continue' | 'skip_to_finalize' = 'continue';
    let errors: StepError[] = [];

    // Track data flowing through the pipeline
    let terminalStatus: RunStatus = 'completed';

    // --- scrapeStep ---
    const scrapeOutput = await scrapeStep.execute({
      inputData: {
        libraries: stackConfig.libraries,
        runId,
        pipelineStatus,
      },
    });
    errors = scrapeOutput.errors;
    pipelineStatus = scrapeOutput.pipelineStatus;

    // --- deduplicateStep (with HydraDB query) ---
    const hydraClient = getHydraDBClient();
    const entriesToDeduplicate = [];
    let hydraDuplicateCount = 0;

    if (hydraClient && pipelineStatus !== 'skip_to_finalize') {
      for (const entry of scrapeOutput.entries) {
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
      entriesToDeduplicate.push(...scrapeOutput.entries);
    }

    const deduplicateOutput = await deduplicateStep.execute({
      inputData: {
        entries: entriesToDeduplicate,
        errors,
        runId,
        pipelineStatus,
      },
    });
    deduplicateOutput.duplicateCount += hydraDuplicateCount;
    errors = deduplicateOutput.errors;
    pipelineStatus = deduplicateOutput.pipelineStatus;
    runRecord.new_change_count = deduplicateOutput.newEntries.length;

    // If dedup set skip_to_finalize and there were no new entries, mark as no_new_changes
    if (pipelineStatus === 'skip_to_finalize' && deduplicateOutput.newEntries.length === 0) {
      terminalStatus = 'no_new_changes';
    }

    // --- summarizeStep ---
    const summarizeOutput = await summarizeStep.execute({
      inputData: {
        newEntries: deduplicateOutput.newEntries,
        errors,
        duplicateCount: deduplicateOutput.duplicateCount,
        runId,
        pipelineStatus,
      },
    });
    errors = summarizeOutput.errors;
    pipelineStatus = summarizeOutput.pipelineStatus;

    // If summarize set skip_to_finalize (LLM failure), mark as llm_failed
    if (
      pipelineStatus === 'skip_to_finalize' &&
      terminalStatus === 'completed' &&
      summarizeOutput.classifiedEntries.length === 0 &&
      deduplicateOutput.newEntries.length > 0
    ) {
      terminalStatus = 'llm_failed';
    }

    // Store classified entries in HydraDB
    if (hydraClient && summarizeOutput.classifiedEntries.length > 0) {
      console.log(
        `[summarize] Storing ${summarizeOutput.classifiedEntries.length} classified entries in HydraDB`,
      );
      await hydraClient.storeChangeEntries(summarizeOutput.classifiedEntries);
    }

    // --- generateScriptStep ---
    const generateScriptOutput = await generateScriptStep.execute({
      inputData: {
        classifiedEntries: summarizeOutput.classifiedEntries,
        errors,
        pipelineStatus,
      },
    });
    errors = generateScriptOutput.errors;
    pipelineStatus = generateScriptOutput.pipelineStatus;
    runRecord.briefing_script = generateScriptOutput.briefingScript;

    // --- ttsStep ---
    const ttsOutput = await ttsStep.execute({
      inputData: {
        briefingScript: generateScriptOutput.briefingScript,
        classifiedEntries: summarizeOutput.classifiedEntries,
        errors,
        runId,
        pipelineStatus,
      },
    });
    errors = ttsOutput.errors;
    pipelineStatus = ttsOutput.pipelineStatus;
    runRecord.audio_url = ttsOutput.audioUrl;

    // --- publishStep ---
    const publishOutput = await publishStep.execute({
      inputData: {
        briefingScript: generateScriptOutput.briefingScript,
        audioUrl: ttsOutput.audioUrl,
        ttsFailed: ttsOutput.ttsFailed,
        classifiedEntries: summarizeOutput.classifiedEntries,
        errors,
        runId,
        pipelineStatus,
      },
    });
    errors = publishOutput.errors;
    pipelineStatus = publishOutput.pipelineStatus;
    runRecord.digest_link = publishOutput.digestLink;

    // --- notifyStep ---
    const notifyOutput = await notifyStep.execute({
      inputData: {
        digestLink: publishOutput.digestLink,
        briefingScript: generateScriptOutput.briefingScript,
        audioUrl: ttsOutput.audioUrl,
        classifiedEntries: summarizeOutput.classifiedEntries,
        errors,
        runId,
        pipelineStatus,
      },
    });
    errors = notifyOutput.errors;

    // --- finalizeRunStep ---
    // Calculate risk counts from classified entries
    let criticalCount = 0;
    let breakingCount = 0;
    let minorCount = 0;
    
    for (const entry of summarizeOutput.classifiedEntries) {
      if (entry.riskLevel === 'CRITICAL') {
        criticalCount++;
      } else if (entry.riskLevel === 'BREAKING') {
        breakingCount++;
      } else {
        minorCount++;
      }
    }

    runRecord.errors = errors;
    runRecord.has_errors = errors.length > 0;
    runRecord.status = terminalStatus;
    runRecord.completed_at = new Date().toISOString();
    runRecord.criticalCount = criticalCount;
    runRecord.breakingCount = breakingCount;
    runRecord.minorCount = minorCount;

    updateRunRecord(runRecord);
    console.log(
      `[pipeline] Run ${runId} finalized: status=${runRecord.status}, errors=${errors.length}`,
    );

    // Store run summary in HydraDB
    if (hydraClient && runRecord.briefing_script) {
      await hydraClient.storeRunSummary(runId, runRecord.briefing_script, {
        trigger_type: triggerType,
        status: runRecord.status,
        libraries_processed: runRecord.libraries_processed,
        new_change_count: runRecord.new_change_count,
        completed_at: runRecord.completed_at,
      });
    }

    return runRecord;
  } catch (err) {
    // Unexpected error — ensure Run_Record reaches terminal status
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] Unexpected error: ${message}`);

    runRecord.errors = [
      ...runRecord.errors,
      { step: 'pipeline', message: `Unexpected error: ${message}` },
    ];
    runRecord.has_errors = true;
    runRecord.status = 'completed';
    runRecord.completed_at = new Date().toISOString();

    try {
      updateRunRecord(runRecord);
    } catch (updateErr) {
      console.error(
        `[pipeline] Failed to update Run_Record on error: ${updateErr instanceof Error ? updateErr.message : String(updateErr)}`,
      );
    }

    return runRecord;
  }
}
