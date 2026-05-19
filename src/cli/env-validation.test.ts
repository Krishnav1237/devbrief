import { describe, it, expect } from 'vitest';
import { validateEnvVars } from './env-validation.js';

describe('validateEnvVars', () => {
  const validEnv = {
    GROQ_API_KEY: 'groq-key-123',
    OLOSTEP_API_KEY: 'olostep-key-456',
    SARVAM_API_KEY: 'sarvam-key-789',
  };

  it('returns valid when all required env vars are present (Groq)', () => {
    const result = validateEnvVars(validEnv);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid when using OLLAMA_BASE_URL instead of GROQ_API_KEY', () => {
    const env = {
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OLOSTEP_API_KEY: 'olostep-key-456',
      SARVAM_API_KEY: 'sarvam-key-789',
    };
    const result = validateEnvVars(env);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid when both GROQ_API_KEY and OLLAMA_BASE_URL are set', () => {
    const env = {
      GROQ_API_KEY: 'groq-key-123',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OLOSTEP_API_KEY: 'olostep-key-456',
      SARVAM_API_KEY: 'sarvam-key-789',
    };
    const result = validateEnvVars(env);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns error when neither GROQ_API_KEY nor OLLAMA_BASE_URL is set', () => {
    const env = {
      OLOSTEP_API_KEY: 'olostep-key-456',
      SARVAM_API_KEY: 'sarvam-key-789',
    };
    const result = validateEnvVars(env);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'At least one LLM provider must be configured: set GROQ_API_KEY or OLLAMA_BASE_URL',
    );
  });

  it('returns error when OLOSTEP_API_KEY is missing', () => {
    const env = {
      GROQ_API_KEY: 'groq-key-123',
      SARVAM_API_KEY: 'sarvam-key-789',
    };
    const result = validateEnvVars(env);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required environment variable: OLOSTEP_API_KEY');
  });

  it('returns error when SARVAM_API_KEY is missing', () => {
    const env = {
      GROQ_API_KEY: 'groq-key-123',
      OLOSTEP_API_KEY: 'olostep-key-456',
    };
    const result = validateEnvVars(env);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required environment variable: SARVAM_API_KEY');
  });

  it('returns multiple errors when multiple env vars are missing', () => {
    const result = validateEnvVars({});
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
    expect(result.errors).toContain(
      'At least one LLM provider must be configured: set GROQ_API_KEY or OLLAMA_BASE_URL',
    );
    expect(result.errors).toContain('Missing required environment variable: OLOSTEP_API_KEY');
    expect(result.errors).toContain('Missing required environment variable: SARVAM_API_KEY');
  });

  it('treats empty string values as missing', () => {
    const env = {
      GROQ_API_KEY: '',
      OLLAMA_BASE_URL: '',
      OLOSTEP_API_KEY: '',
      SARVAM_API_KEY: '',
    };
    const result = validateEnvVars(env);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });
});
