import axios from 'axios';
import pLimit from 'p-limit';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const CACHE_DIR = path.join(os.homedir(), '.devbrief', 'registry-cache');
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const DEFAULT_TIMEOUT_MS = 5000;

// Globally throttle all registry client fetches to 5 concurrent requests
const limit = pLimit(5);

interface CacheEntry<T> {
  url: string;
  timestamp: number;
  data: T;
}

function getCacheFilePath(url: string): string {
  const hash = crypto.createHash('sha256').update(url).digest('hex');
  return path.join(CACHE_DIR, `${hash}.json`);
}

function readFromCacheFile<T>(filePath: string, ignoreTtl = false): T | undefined {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const entry = JSON.parse(content) as CacheEntry<T>;
      const age = Date.now() - entry.timestamp;
      if (ignoreTtl || age < DEFAULT_TTL_MS) {
        return entry.data;
      }
    }
  } catch (err) {
    // Ignore cache read errors
  }
  return undefined;
}

function writeToCacheFile<T>(filePath: string, url: string, data: T): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const entry: CacheEntry<T> = {
      url,
      timestamp: Date.now(),
      data,
    };
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  } catch (err) {
    // Ignore cache write errors
  }
}

async function fetchWithRetryAndJitter<T>(
  url: string,
  headers: Record<string, string>,
  timeout: number,
): Promise<T> {
  let lastError: any = null;
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url, { headers, timeout });
      return response.data as T;
    } catch (err: any) {
      lastError = err;

      // 4xx client errors (like 404 Not Found) should not be retried unless it is a 429 Too Many Requests
      const isClientError = err.response && err.response.status >= 400 && err.response.status < 500;
      const isRateLimit = err.response && err.response.status === 429;
      if (isClientError && !isRateLimit) {
        throw err;
      }

      if (attempt === maxRetries) {
        throw err;
      }

      const delay = 200 * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Robust cached and throttled HTTP registry client.
 */
export async function fetchWithRegistryClient<T>(
  url: string,
  options?: { headers?: Record<string, string>; timeout?: number },
): Promise<T | undefined> {
  const cachePath = getCacheFilePath(url);
  const isOffline = process.env.DEVBRIEF_OFFLINE === '1';

  // 1. If offline mode is enabled, attempt to read from cache (ignoring TTL), otherwise return undefined.
  if (isOffline) {
    return readFromCacheFile<T>(cachePath, true);
  }

  // 2. Read from cache (enforcing 12-hour TTL)
  const cached = readFromCacheFile<T>(cachePath, false);
  if (cached !== undefined) {
    return cached;
  }

  // 3. Perform throttled rate-limited HTTP fetch with retry
  return limit(async (): Promise<T | undefined> => {
    // Check cache again in case a parallel request has updated it
    const parallelCached = readFromCacheFile<T>(cachePath, false);
    if (parallelCached !== undefined) {
      return parallelCached;
    }

    try {
      const headers = options?.headers ?? {};
      const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
      const data = await fetchWithRetryAndJitter<T>(url, headers, timeout);
      writeToCacheFile<T>(cachePath, url, data);
      return data;
    } catch (err: any) {
      // 4. Fallback to expired cache if fetch fails (resilience check)
      const expiredCache = readFromCacheFile<T>(cachePath, true);
      if (expiredCache !== undefined) {
        console.warn(`Registry query failed for ${url}. Falling back to expired cache.`);
        return expiredCache;
      }
      console.warn(`Registry client failed to fetch ${url}: ${err.message}`);
      return undefined;
    }
  });
}
