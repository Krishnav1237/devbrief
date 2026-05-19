/**
 * Unit tests for the cron scheduler module.
 *
 * Requirements: 2.1, 2.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startScheduler, stopScheduler } from './index.js';

// Mock node-cron
vi.mock('node-cron', () => {
  const mockTask = {
    stop: vi.fn(),
    start: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
  };

  return {
    default: {
      schedule: vi.fn(() => mockTask),
      validate: vi.fn((expr: string) => {
        // Simple validation: reject obviously invalid expressions
        if (expr === 'invalid') return false;
        return true;
      }),
    },
  };
});

// Mock workflow
vi.mock('../workflow.js', () => ({
  isRunInProgress: vi.fn(() => false),
  runDevBriefPipeline: vi.fn(async () => ({
    run_id: 'test-run-id',
    status: 'completed',
  })),
}));

import cron from 'node-cron';
import { isRunInProgress, runDevBriefPipeline } from '../workflow.js';

describe('Cron Scheduler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    // Reset the module-level scheduledTask by stopping any existing one
    stopScheduler();
  });

  afterEach(() => {
    stopScheduler();
    process.env = originalEnv;
  });

  describe('startScheduler', () => {
    it('should start with default cron expression when DEVBRIEF_CRON is not set', () => {
      delete process.env.DEVBRIEF_CRON;

      startScheduler();

      expect(cron.schedule).toHaveBeenCalledWith(
        '0 7 * * *',
        expect.any(Function),
      );
    });

    it('should use DEVBRIEF_CRON env var when set', () => {
      process.env.DEVBRIEF_CRON = '30 8 * * 1-5';

      startScheduler();

      expect(cron.schedule).toHaveBeenCalledWith(
        '30 8 * * 1-5',
        expect.any(Function),
      );
    });

    it('should throw on invalid cron expression', () => {
      process.env.DEVBRIEF_CRON = 'invalid';

      expect(() => startScheduler()).toThrow('Invalid cron expression');
    });

    it('should return the scheduled task', () => {
      const task = startScheduler();
      expect(task).toBeDefined();
      expect(task.stop).toBeDefined();
    });
  });

  describe('cron callback', () => {
    it('should skip run when a pipeline run is already in progress', async () => {
      vi.mocked(isRunInProgress).mockReturnValue(true);

      startScheduler();

      // Extract the callback passed to cron.schedule
      const callback = vi.mocked(cron.schedule).mock.calls[0][1] as Function;
      await callback();

      expect(runDevBriefPipeline).not.toHaveBeenCalled();
    });

    it('should trigger pipeline run with cron trigger type', async () => {
      vi.mocked(isRunInProgress).mockReturnValue(false);

      startScheduler();

      const callback = vi.mocked(cron.schedule).mock.calls[0][1] as Function;
      await callback();

      expect(runDevBriefPipeline).toHaveBeenCalledWith('cron');
    });

    it('should handle pipeline errors gracefully', async () => {
      vi.mocked(isRunInProgress).mockReturnValue(false);
      vi.mocked(runDevBriefPipeline).mockRejectedValue(new Error('Pipeline failed'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      startScheduler();

      const callback = vi.mocked(cron.schedule).mock.calls[0][1] as Function;
      await callback();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline failed'),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('stopScheduler', () => {
    it('should stop the scheduled task', () => {
      const task = startScheduler();

      stopScheduler();

      expect(task.stop).toHaveBeenCalled();
    });

    it('should be safe to call when no scheduler is running', () => {
      // Should not throw
      expect(() => stopScheduler()).not.toThrow();
    });
  });
});
