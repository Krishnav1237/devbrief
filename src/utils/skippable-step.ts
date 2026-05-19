import { z } from 'zod';

// ---------------------------------------------------------------------------
// Pipeline status schema (shared across all skippable steps)
// ---------------------------------------------------------------------------

export const PipelineStatusSchema = z.enum(['continue', 'skip_to_finalize']);
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

// ---------------------------------------------------------------------------
// Step definition type (matches the existing step pattern in the codebase)
// ---------------------------------------------------------------------------

/**
 * A step definition compatible with the project's existing step pattern.
 * Each step has an id, description, Zod input/output schemas, and an
 * async execute function.
 */
export interface StepDefinition<
  TInputSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TOutputSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  id: string;
  description?: string;
  inputSchema: TInputSchema;
  outputSchema: TOutputSchema;
  execute: (params: { inputData: z.infer<TInputSchema> }) => Promise<z.infer<TOutputSchema>>;
}

// ---------------------------------------------------------------------------
// createSkippableStep() wrapper
// ---------------------------------------------------------------------------

/**
 * Wraps a step definition so that `pipelineStatus` is automatically handled:
 *
 * 1. Extends the input schema to include `pipelineStatus?: 'continue' | 'skip_to_finalize'`
 * 2. Extends the output schema to include `pipelineStatus: 'continue' | 'skip_to_finalize'`
 * 3. Before calling the inner execute, checks `pipelineStatus` — if
 *    `'skip_to_finalize'`, returns a pass-through output immediately with
 *    all output fields set to their Zod-inferred defaults and
 *    `pipelineStatus: 'skip_to_finalize'`
 * 4. If the inner execute doesn't set `pipelineStatus` in its return value,
 *    defaults to `'continue'`
 *
 * This prevents individual steps from silently dropping the skip signal.
 *
 * **Validates: Requirements 4.4, 5.6**
 */
export function createSkippableStep<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(config: {
  id: string;
  description?: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  execute: (params: { inputData: z.infer<TInput> }) => Promise<z.infer<TOutput>>;
}): StepDefinition {
  // Extend input schema with optional pipelineStatus
  const extendedInputSchema = config.inputSchema instanceof z.ZodObject
    ? (config.inputSchema as z.AnyZodObject).extend({
        pipelineStatus: PipelineStatusSchema.optional(),
      })
    : z.intersection(
        config.inputSchema,
        z.object({ pipelineStatus: PipelineStatusSchema.optional() }),
      );

  // Extend output schema with required pipelineStatus
  const extendedOutputSchema = config.outputSchema instanceof z.ZodObject
    ? (config.outputSchema as z.AnyZodObject).extend({
        pipelineStatus: PipelineStatusSchema,
      })
    : z.intersection(
        config.outputSchema,
        z.object({ pipelineStatus: PipelineStatusSchema }),
      );

  /**
   * Builds a pass-through output object for skip mode.
   * Uses Zod's schema shape to produce sensible defaults for each field type:
   *   - string → '' (nullable string → null)
   *   - number → 0
   *   - boolean → false
   *   - array → []
   *   - object → {}
   *   - nullable → null
   *   - optional → undefined
   *   - everything else → undefined
   */
  function buildPassThroughOutput(schema: z.ZodTypeAny): Record<string, unknown> {
    const defaults: Record<string, unknown> = {};

    if (schema instanceof z.ZodObject) {
      const shape = schema.shape as Record<string, z.ZodTypeAny>;
      for (const [key, fieldSchema] of Object.entries(shape)) {
        defaults[key] = getDefaultForSchema(fieldSchema);
      }
    }

    // Always set pipelineStatus to skip_to_finalize
    defaults['pipelineStatus'] = 'skip_to_finalize';
    return defaults;
  }

  return {
    id: config.id,
    description: config.description,
    inputSchema: extendedInputSchema,
    outputSchema: extendedOutputSchema,

    execute: async ({ inputData }: { inputData: Record<string, unknown> }) => {
      // Check pipelineStatus before calling the inner execute
      if (inputData.pipelineStatus === 'skip_to_finalize') {
        return buildPassThroughOutput(config.outputSchema);
      }

      // Call the inner execute
      const result = await config.execute({ inputData: inputData as z.infer<TInput> });

      // Ensure pipelineStatus is always propagated — default to 'continue'
      if (result && typeof result === 'object' && !('pipelineStatus' in result)) {
        (result as Record<string, unknown>).pipelineStatus = 'continue';
      }

      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// Schema default value helpers
// ---------------------------------------------------------------------------

/**
 * Returns a sensible default value for a given Zod schema type.
 * Used to build pass-through outputs when a step is skipped.
 */
function getDefaultForSchema(schema: z.ZodTypeAny): unknown {
  // Unwrap ZodOptional
  if (schema instanceof z.ZodOptional) {
    return undefined;
  }

  // Unwrap ZodNullable — return null
  if (schema instanceof z.ZodNullable) {
    return null;
  }

  // Unwrap ZodDefault — use the default value
  if (schema instanceof z.ZodDefault) {
    return schema._def.defaultValue();
  }

  // Primitives
  if (schema instanceof z.ZodString) {
    return '';
  }
  if (schema instanceof z.ZodNumber) {
    return 0;
  }
  if (schema instanceof z.ZodBoolean) {
    return false;
  }

  // Arrays
  if (schema instanceof z.ZodArray) {
    return [];
  }

  // Objects
  if (schema instanceof z.ZodObject) {
    return {};
  }

  // Enums — return the first value
  if (schema instanceof z.ZodEnum) {
    const values = schema._def.values as string[];
    return values[0];
  }

  // Literal
  if (schema instanceof z.ZodLiteral) {
    return schema._def.value;
  }

  // Fallback
  return undefined;
}
