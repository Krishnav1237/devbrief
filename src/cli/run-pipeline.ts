/**
 * Pipeline runner for CLI and other trigger sources.
 * Delegates to the actual workflow pipeline in src/workflow.ts.
 */

import { runDevBriefPipeline } from '../workflow.js';

export type TriggerType = 'manual' | 'cron' | 'webhook';

/**
 * Runs the DevBrief pipeline.
 *
 * @param triggerType - How the pipeline was triggered
 */
export async function runPipeline(triggerType: TriggerType): Promise<void> {
  const runRecord = await runDevBriefPipeline(triggerType);

  console.log(`\nRun ID:    ${runRecord.run_id}`);
  console.log(`Status:    ${runRecord.status}`);
  console.log(`Changes:   ${runRecord.new_change_count} new`);
  console.log(`Errors:    ${runRecord.errors.length}`);

  if (runRecord.digest_link) {
    console.log(`Digest:    ${runRecord.digest_link}`);
  }
  if (runRecord.audio_url) {
    console.log(`Audio:     ${runRecord.audio_url}`);
  }

  if (runRecord.errors.length > 0) {
    console.log('\nErrors:');
    for (const err of runRecord.errors) {
      const lib = err.library_name ? ` [${err.library_name}]` : '';
      console.log(`  - ${err.step}${lib}: ${err.message}`);
    }
  }
}
