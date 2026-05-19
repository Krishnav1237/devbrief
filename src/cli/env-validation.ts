/**
 * Environment variable validation for DevBrief.
 * Reusable by both the CLI `run` command and the HTTP server entry point.
 */

export interface EnvValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates that all required environment variables are present.
 *
 * Required:
 * - At least one of GROQ_API_KEY or OLLAMA_BASE_URL (LLM provider)
 * - OLOSTEP_API_KEY (web scraping)
 * - SARVAM_API_KEY (text-to-speech)
 *
 * @param env - The environment object to validate (defaults to process.env)
 * @returns Validation result with any error messages
 */
export function validateEnvVars(env: Record<string, string | undefined> = process.env): EnvValidationResult {
  const errors: string[] = [];

  const hasGroq = Boolean(env.GROQ_API_KEY);
  const hasOllama = Boolean(env.OLLAMA_BASE_URL);

  if (!hasGroq && !hasOllama) {
    errors.push(
      'At least one LLM provider must be configured: set GROQ_API_KEY or OLLAMA_BASE_URL',
    );
  }

  if (!env.OLOSTEP_API_KEY) {
    errors.push('Missing required environment variable: OLOSTEP_API_KEY');
  }

  if (!env.SARVAM_API_KEY) {
    errors.push('Missing required environment variable: SARVAM_API_KEY');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
