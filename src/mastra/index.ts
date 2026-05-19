/**
 * Mastra instance setup for DevBrief.
 *
 * Registers the DevBrief pipeline workflow with the Mastra framework.
 */

import { Mastra } from '@mastra/core';
import { devbriefPipeline } from './workflows/devbrief-pipeline.js';

export const mastra = new Mastra({
  workflows: {
    'devbrief-pipeline': devbriefPipeline,
  },
});
