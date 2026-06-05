import { z } from 'zod';
import axios from 'axios';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import ffmpeg from 'fluent-ffmpeg';
import {
  StepErrorSchema,
  type StepError,
} from '../models/index.js';
import {
  ClassifiedChangeEntrySchema,
  type ClassifiedChangeEntry,
} from './summarize.js';

// ---------------------------------------------------------------------------
// Zod schemas for step I/O
// ---------------------------------------------------------------------------

const PipelineStatusSchema = z.enum(['continue', 'skip_to_finalize']);
export type PipelineStatus = z.infer<typeof PipelineStatusSchema>;

export const TTSInputSchema = z.object({
  briefingScript: z.string().nullable(),
  classifiedEntries: z.array(ClassifiedChangeEntrySchema),
  errors: z.array(StepErrorSchema),
  runId: z.string().uuid(),
  pipelineStatus: PipelineStatusSchema.optional(),
});
export type TTSInput = z.infer<typeof TTSInputSchema>;

export const TTSOutputSchema = z.object({
  audioUrl: z.string().nullable(),
  ttsFailed: z.boolean(),
  classifiedEntries: z.array(ClassifiedChangeEntrySchema),
  briefingScript: z.string().nullable(),
  errors: z.array(StepErrorSchema),
  pipelineStatus: PipelineStatusSchema,
});
export type TTSOutput = z.infer<typeof TTSOutputSchema>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SARVAM_TTS_ENDPOINT = 'https://api.sarvam.ai/text-to-speech';
const MAX_CHARS_PER_CHUNK = 2500;
const AUDIO_DIR = path.join(os.homedir(), '.devbrief', 'audio');

// ---------------------------------------------------------------------------
// Pure functions (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Splits text at sentence boundaries, ensuring each chunk is at most
 * `maxChars` characters. Concatenating all chunks reproduces the original text.
 *
 * Sentence boundaries are detected at `.`, `!`, or `?` followed by a space
 * or end of string. If a single sentence exceeds `maxChars`, it is placed
 * in its own chunk (we never split mid-sentence).
 */
export function chunkText(text: string, maxChars: number = MAX_CHARS_PER_CHUNK): string[] {
  if (text.length === 0) return [];
  if (text.length <= maxChars) return [text];

  // Split text into sentences. We keep the delimiter attached to the sentence.
  // Match sentence-ending punctuation followed by a space or end of string.
  const sentences: string[] = [];
  const regex = /[^.!?]*[.!?](?:\s|$)|[^.!?]+$/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    sentences.push(match[0]);
  }

  // If regex produced nothing (e.g., no sentence-ending punctuation), treat entire text as one sentence
  if (sentences.length === 0) {
    return [text];
  }

  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    // If adding this sentence would exceed the limit
    if (currentChunk.length + sentence.length > maxChars) {
      // Push the current chunk if it has content
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = '';
      }

      // If the sentence itself exceeds maxChars, it goes in its own chunk
      // (we never split mid-sentence)
      if (sentence.length > maxChars) {
        chunks.push(sentence);
        continue;
      }
    }

    currentChunk += sentence;
  }

  // Push any remaining content
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Delays execution for the specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls the Sarvam AI TTS API for a single text chunk.
 * Returns the base64-encoded audio data.
 */
async function callSarvamTTS(text: string, apiKey: string): Promise<string> {
  try {
    const response = await axios.post(
      SARVAM_TTS_ENDPOINT,
      {
        text,
        target_language_code: 'en-IN',
        speaker: 'amit',
        model: 'bulbul:v3',
        pace: 1.0,
        speech_sample_rate: 22050,
        output_audio_codec: 'mp3',
        enable_preprocessing: true,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': apiKey,
        },
      },
    );

    const base64Audio = response.data?.audios?.[0];
    if (!base64Audio) {
      throw new Error('Sarvam API did not return audio content');
    }
    return base64Audio;
  } catch (err: any) {
    if (err.response?.data) {
      console.error('[tts] Sarvam error response:', JSON.stringify(err.response.data));
    }
    throw err;
  }
}

/**
 * Calls Sarvam AI TTS with a single retry on failure.
 */
async function callSarvamTTSWithRetry(text: string, apiKey: string): Promise<string> {
  try {
    return await callSarvamTTS(text, apiKey);
  } catch (firstError) {
    console.warn(
      `[tts] Sarvam AI call failed, retrying:`,
      firstError instanceof Error ? firstError.message : String(firstError),
    );
    await delay(1000);
    return await callSarvamTTS(text, apiKey);
  }
}

/**
 * Writes base64-encoded audio data to a temporary file.
 * Returns the file path.
 */
function writeBase64AudioToFile(base64Data: string, filePath: string): void {
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(filePath, buffer);
}

/**
 * Concatenates multiple audio files using ffmpeg with a brief silence gap
 * (15ms) between segments. Returns a promise that resolves when done.
 */
function concatenateAudioFiles(
  inputFiles: string[],
  outputFile: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (inputFiles.length === 0) {
      reject(new Error('No input files to concatenate'));
      return;
    }

    if (inputFiles.length === 1) {
      // Single file — just copy it
      fs.copyFileSync(inputFiles[0], outputFile);
      resolve();
      return;
    }

    // Build a complex filter that inserts 15ms silence gaps between segments.
    // We generate a short silence for each gap, then concatenate all segments
    // with silence in between.
    const inputs: string[] = [];
    const filterParts: string[] = [];
    let streamIndex = 0;

    // Add all input audio files
    for (const file of inputFiles) {
      inputs.push(file);
    }

    // Build the filter_complex string:
    // For N audio files, we need N-1 silence gaps.
    // Each input is [0:a], [1:a], etc.
    // We generate silence using anullsrc and trim it to 15ms.
    const silenceCount = inputFiles.length - 1;
    const concatInputs: string[] = [];

    for (let i = 0; i < inputFiles.length; i++) {
      concatInputs.push(`[${i}:a]`);
      if (i < inputFiles.length - 1) {
        // Add a silence stream
        const silLabel = `sil${i}`;
        filterParts.push(
          `anullsrc=r=44100:cl=mono[${silLabel}_raw];[${silLabel}_raw]atrim=duration=0.015[${silLabel}]`,
        );
        concatInputs.push(`[${silLabel}]`);
      }
    }

    // Concat all streams
    const totalStreams = inputFiles.length + silenceCount;
    const concatFilter = `${concatInputs.join('')}concat=n=${totalStreams}:v=0:a=1[out]`;
    filterParts.push(concatFilter);

    const filterComplex = filterParts.join(';');

    let cmd = ffmpeg();
    for (const file of inputs) {
      cmd = cmd.input(file);
    }

    cmd
      .complexFilter(filterComplex)
      .outputOptions(['-map', '[out]'])
      .output(outputFile)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .run();
  });
}

/**
 * Ensures the audio directory exists.
 */
function ensureAudioDir(): void {
  if (!fs.existsSync(AUDIO_DIR)) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Mastra step definition
// ---------------------------------------------------------------------------

/**
 * The TTS step: converts the Briefing_Script to audio using Sarvam AI's
 * Bulbul V3 REST API.
 *
 * Note: Uses manual pipelineStatus checking for now. Will be refactored to
 * use createSkippableStep() wrapper in Task 13.1.
 */
export const ttsStep = {
  id: 'tts' as const,
  description: 'Convert briefing script to audio via Sarvam AI TTS',
  inputSchema: TTSInputSchema,
  outputSchema: TTSOutputSchema,

  execute: async ({
    inputData,
  }: {
    inputData: TTSInput;
  }): Promise<TTSOutput> => {
    const { briefingScript, classifiedEntries, errors, runId, pipelineStatus } = inputData;

    // Early-exit propagation (manual check — will be handled by createSkippableStep in Task 13.1)
    if (pipelineStatus === 'skip_to_finalize') {
      return {
        audioUrl: null,
        ttsFailed: false,
        classifiedEntries: classifiedEntries ?? [],
        briefingScript: briefingScript ?? null,
        errors: errors ?? [],
        pipelineStatus: 'skip_to_finalize',
      };
    }

    // If no briefing script, nothing to convert
    if (!briefingScript) {
      return {
        audioUrl: null,
        ttsFailed: true,
        classifiedEntries: classifiedEntries ?? [],
        briefingScript: null,
        errors: [
          ...(errors ?? []),
          { step: 'tts', message: 'No briefing script available for TTS' },
        ],
        pipelineStatus: 'continue',
      };
    }

    const apiKey = process.env.SARVAM_API_KEY;
    if (!apiKey) {
      console.error('[tts] SARVAM_API_KEY not set');
      return {
        audioUrl: null,
        ttsFailed: true,
        classifiedEntries: classifiedEntries ?? [],
        briefingScript,
        errors: [
          ...(errors ?? []),
          { step: 'tts', message: 'SARVAM_API_KEY not configured' },
        ],
        pipelineStatus: 'continue',
      };
    }

    try {
      // Chunk the text
      const chunks = chunkText(briefingScript);
      console.log(`[tts] Split script into ${chunks.length} chunk(s)`);

      // Ensure audio directory exists
      ensureAudioDir();

      // Create a temp directory for intermediate files
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devbrief-tts-'));

      try {
        // Submit sequential requests for each chunk
        const chunkFiles: string[] = [];

        for (let i = 0; i < chunks.length; i++) {
          console.log(`[tts] Processing chunk ${i + 1}/${chunks.length}`);
          const base64Audio = await callSarvamTTSWithRetry(chunks[i], apiKey);

          const chunkFile = path.join(tmpDir, `chunk-${i}.mp3`);
          writeBase64AudioToFile(base64Audio, chunkFile);
          chunkFiles.push(chunkFile);
        }

        // Concatenate audio chunks
        const outputFile = path.join(AUDIO_DIR, `${runId}.mp3`);

        if (chunkFiles.length === 1) {
          // Single chunk — just copy
          fs.copyFileSync(chunkFiles[0], outputFile);
        } else {
          // Multiple chunks — concatenate with silence gaps
          await concatenateAudioFiles(chunkFiles, outputFile);
        }

        console.log(`[tts] Audio saved to ${outputFile}`);

        return {
          audioUrl: outputFile,
          ttsFailed: false,
          classifiedEntries: classifiedEntries ?? [],
          briefingScript,
          errors: errors ?? [],
          pipelineStatus: 'continue',
        };
      } finally {
        // Clean up temp files
        try {
          for (const file of fs.readdirSync(tmpDir)) {
            fs.unlinkSync(path.join(tmpDir, file));
          }
          fs.rmdirSync(tmpDir);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[tts] TTS failed: ${message}`);

      return {
        audioUrl: null,
        ttsFailed: true,
        classifiedEntries: classifiedEntries ?? [],
        briefingScript,
        errors: [
          ...(errors ?? []),
          { step: 'tts', message: `TTS error: ${message}` },
        ],
        pipelineStatus: 'continue',
      };
    }
  },
};
