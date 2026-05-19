import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createSkippableStep, PipelineStatusSchema } from './skippable-step.js';

// ---------------------------------------------------------------------------
// Test schemas
// ---------------------------------------------------------------------------

const TestInputSchema = z.object({
  items: z.array(z.string()),
  count: z.number(),
});

const TestOutputSchema = z.object({
  result: z.string(),
  items: z.array(z.string()),
  total: z.number(),
  success: z.boolean(),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSkippableStep', () => {
  it('should return a step with the same id and description', () => {
    const step = createSkippableStep({
      id: 'test-step',
      description: 'A test step',
      inputSchema: TestInputSchema,
      outputSchema: TestOutputSchema,
      execute: async () => ({
        result: 'done',
        items: [],
        total: 0,
        success: true,
      }),
    });

    expect(step.id).toBe('test-step');
    expect(step.description).toBe('A test step');
  });

  it('should extend input schema to accept pipelineStatus', () => {
    const step = createSkippableStep({
      id: 'test-step',
      inputSchema: TestInputSchema,
      outputSchema: TestOutputSchema,
      execute: async () => ({
        result: 'done',
        items: [],
        total: 0,
        success: true,
      }),
    });

    // The extended input schema should accept pipelineStatus
    const validInput = {
      items: ['a'],
      count: 1,
      pipelineStatus: 'continue' as const,
    };
    const parsed = step.inputSchema.parse(validInput);
    expect(parsed.pipelineStatus).toBe('continue');

    // Should also accept input without pipelineStatus (optional)
    const withoutStatus = { items: ['b'], count: 2 };
    const parsed2 = step.inputSchema.parse(withoutStatus);
    expect(parsed2.pipelineStatus).toBeUndefined();
  });

  it('should extend output schema to require pipelineStatus', () => {
    const step = createSkippableStep({
      id: 'test-step',
      inputSchema: TestInputSchema,
      outputSchema: TestOutputSchema,
      execute: async () => ({
        result: 'done',
        items: [],
        total: 0,
        success: true,
      }),
    });

    // The extended output schema should require pipelineStatus
    const validOutput = {
      result: 'done',
      items: [],
      total: 0,
      success: true,
      pipelineStatus: 'continue',
    };
    const parsed = step.outputSchema.parse(validOutput);
    expect(parsed.pipelineStatus).toBe('continue');

    // Should reject output without pipelineStatus
    const withoutStatus = {
      result: 'done',
      items: [],
      total: 0,
      success: true,
    };
    expect(() => step.outputSchema.parse(withoutStatus)).toThrow();
  });

  it('should call inner execute when pipelineStatus is "continue"', async () => {
    const executeFn = vi.fn().mockResolvedValue({
      result: 'processed',
      items: ['x', 'y'],
      total: 2,
      success: true,
      pipelineStatus: 'continue',
    });

    const step = createSkippableStep({
      id: 'test-step',
      inputSchema: TestInputSchema,
      outputSchema: TestOutputSchema,
      execute: executeFn,
    });

    const output = await step.execute({
      inputData: {
        items: ['x', 'y'],
        count: 2,
        pipelineStatus: 'continue',
      },
    });

    expect(executeFn).toHaveBeenCalledOnce();
    expect(output.result).toBe('processed');
    expect(output.items).toEqual(['x', 'y']);
    expect(output.total).toBe(2);
    expect(output.success).toBe(true);
    expect(output.pipelineStatus).toBe('continue');
  });

  it('should call inner execute when pipelineStatus is undefined', async () => {
    const executeFn = vi.fn().mockResolvedValue({
      result: 'processed',
      items: [],
      total: 0,
      success: true,
    });

    const step = createSkippableStep({
      id: 'test-step',
      inputSchema: TestInputSchema,
      outputSchema: TestOutputSchema,
      execute: executeFn,
    });

    const output = await step.execute({
      inputData: {
        items: [],
        count: 0,
      },
    });

    expect(executeFn).toHaveBeenCalledOnce();
    expect(output.result).toBe('processed');
    // pipelineStatus should default to 'continue' since inner didn't set it
    expect(output.pipelineStatus).toBe('continue');
  });

  it('should skip inner execute when pipelineStatus is "skip_to_finalize"', async () => {
    const executeFn = vi.fn().mockResolvedValue({
      result: 'should not be called',
      items: [],
      total: 0,
      success: true,
    });

    const step = createSkippableStep({
      id: 'test-step',
      inputSchema: TestInputSchema,
      outputSchema: TestOutputSchema,
      execute: executeFn,
    });

    const output = await step.execute({
      inputData: {
        items: ['a', 'b'],
        count: 2,
        pipelineStatus: 'skip_to_finalize',
      },
    });

    // Inner execute should NOT have been called
    expect(executeFn).not.toHaveBeenCalled();

    // Output should have pass-through defaults
    expect(output.pipelineStatus).toBe('skip_to_finalize');
    expect(output.result).toBe('');
    expect(output.items).toEqual([]);
    expect(output.total).toBe(0);
    expect(output.success).toBe(false);
  });

  it('should default pipelineStatus to "continue" when inner execute omits it', async () => {
    const step = createSkippableStep({
      id: 'test-step',
      inputSchema: TestInputSchema,
      outputSchema: TestOutputSchema,
      execute: async ({ inputData }) => ({
        result: `got ${inputData.count} items`,
        items: inputData.items,
        total: inputData.count,
        success: true,
        // Note: pipelineStatus is NOT set here
      }),
    });

    const output = await step.execute({
      inputData: {
        items: ['hello'],
        count: 1,
        pipelineStatus: 'continue',
      },
    });

    expect(output.pipelineStatus).toBe('continue');
    expect(output.result).toBe('got 1 items');
  });

  it('should propagate "skip_to_finalize" set by inner execute', async () => {
    const step = createSkippableStep({
      id: 'test-step',
      inputSchema: TestInputSchema,
      outputSchema: TestOutputSchema,
      execute: async () => ({
        result: 'error occurred',
        items: [],
        total: 0,
        success: false,
        pipelineStatus: 'skip_to_finalize' as const,
      }),
    });

    const output = await step.execute({
      inputData: {
        items: ['a'],
        count: 1,
        pipelineStatus: 'continue',
      },
    });

    expect(output.pipelineStatus).toBe('skip_to_finalize');
    expect(output.result).toBe('error occurred');
    expect(output.success).toBe(false);
  });

  it('should handle nullable fields in pass-through output', async () => {
    const NullableOutputSchema = z.object({
      data: z.string().nullable(),
      items: z.array(z.string()),
      count: z.number(),
    });

    const step = createSkippableStep({
      id: 'nullable-step',
      inputSchema: TestInputSchema,
      outputSchema: NullableOutputSchema,
      execute: async () => ({
        data: 'some data',
        items: ['a'],
        count: 1,
      }),
    });

    const output = await step.execute({
      inputData: {
        items: [],
        count: 0,
        pipelineStatus: 'skip_to_finalize',
      },
    });

    expect(output.pipelineStatus).toBe('skip_to_finalize');
    expect(output.data).toBeNull();
    expect(output.items).toEqual([]);
    expect(output.count).toBe(0);
  });

  it('should handle optional fields in pass-through output', async () => {
    const OptionalOutputSchema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });

    const step = createSkippableStep({
      id: 'optional-step',
      inputSchema: TestInputSchema,
      outputSchema: OptionalOutputSchema,
      execute: async () => ({
        required: 'value',
        optional: 'also set',
      }),
    });

    const output = await step.execute({
      inputData: {
        items: [],
        count: 0,
        pipelineStatus: 'skip_to_finalize',
      },
    });

    expect(output.pipelineStatus).toBe('skip_to_finalize');
    expect(output.required).toBe('');
    expect(output.optional).toBeUndefined();
  });

  it('should handle enum fields in pass-through output', async () => {
    const EnumOutputSchema = z.object({
      status: z.enum(['active', 'inactive', 'pending']),
      name: z.string(),
    });

    const step = createSkippableStep({
      id: 'enum-step',
      inputSchema: TestInputSchema,
      outputSchema: EnumOutputSchema,
      execute: async () => ({
        status: 'active' as const,
        name: 'test',
      }),
    });

    const output = await step.execute({
      inputData: {
        items: [],
        count: 0,
        pipelineStatus: 'skip_to_finalize',
      },
    });

    expect(output.pipelineStatus).toBe('skip_to_finalize');
    // Enum defaults to first value
    expect(output.status).toBe('active');
    expect(output.name).toBe('');
  });

  it('should work with a realistic pipeline step schema', async () => {
    // Mimics the generate-script step pattern
    const ScriptInputSchema = z.object({
      classifiedEntries: z.array(z.object({
        library_name: z.string(),
        summary: z.string(),
      })),
      errors: z.array(z.object({
        step: z.string(),
        message: z.string(),
      })),
    });

    const ScriptOutputSchema = z.object({
      briefingScript: z.string().nullable(),
      classifiedEntries: z.array(z.object({
        library_name: z.string(),
        summary: z.string(),
      })),
      errors: z.array(z.object({
        step: z.string(),
        message: z.string(),
      })),
    });

    const step = createSkippableStep({
      id: 'generate-script',
      description: 'Generate briefing script from classified entries',
      inputSchema: ScriptInputSchema,
      outputSchema: ScriptOutputSchema,
      execute: async ({ inputData }) => ({
        briefingScript: 'Hello, here is your briefing.',
        classifiedEntries: inputData.classifiedEntries,
        errors: inputData.errors,
      }),
    });

    // Test normal execution
    const normalOutput = await step.execute({
      inputData: {
        classifiedEntries: [{ library_name: 'react', summary: 'New hooks API' }],
        errors: [],
        pipelineStatus: 'continue',
      },
    });

    expect(normalOutput.briefingScript).toBe('Hello, here is your briefing.');
    expect(normalOutput.classifiedEntries).toHaveLength(1);
    expect(normalOutput.pipelineStatus).toBe('continue');

    // Test skip execution
    const skipOutput = await step.execute({
      inputData: {
        classifiedEntries: [{ library_name: 'react', summary: 'New hooks API' }],
        errors: [{ step: 'summarize', message: 'LLM failed' }],
        pipelineStatus: 'skip_to_finalize',
      },
    });

    expect(skipOutput.briefingScript).toBeNull();
    expect(skipOutput.classifiedEntries).toEqual([]);
    expect(skipOutput.errors).toEqual([]);
    expect(skipOutput.pipelineStatus).toBe('skip_to_finalize');
  });

  it('should not modify the original config schemas', () => {
    const originalInputShape = Object.keys((TestInputSchema as z.AnyZodObject).shape);
    const originalOutputShape = Object.keys((TestOutputSchema as z.AnyZodObject).shape);

    createSkippableStep({
      id: 'test-step',
      inputSchema: TestInputSchema,
      outputSchema: TestOutputSchema,
      execute: async () => ({
        result: 'done',
        items: [],
        total: 0,
        success: true,
      }),
    });

    // Original schemas should be unchanged
    const afterInputShape = Object.keys((TestInputSchema as z.AnyZodObject).shape);
    const afterOutputShape = Object.keys((TestOutputSchema as z.AnyZodObject).shape);

    expect(afterInputShape).toEqual(originalInputShape);
    expect(afterOutputShape).toEqual(originalOutputShape);
    expect(originalInputShape).not.toContain('pipelineStatus');
    expect(originalOutputShape).not.toContain('pipelineStatus');
  });
});
