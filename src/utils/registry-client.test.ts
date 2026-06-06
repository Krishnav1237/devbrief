import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';

const tempHome = path.join(process.cwd(), 'temp-registry-client-test-home');

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => tempHome,
  };
});

const { fetchWithRegistryClient } = await import('./registry-client.js');

describe('resilient registry client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEVBRIEF_OFFLINE;
    if (fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
    fs.mkdirSync(tempHome, { recursive: true });
  });

  afterEach(() => {
    delete process.env.DEVBRIEF_OFFLINE;
    if (fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('performs HTTP fetches and caches responses locally', async () => {
    const spy = vi.spyOn(axios, 'get').mockResolvedValue({ data: { version: '1.2.3' } });

    const res1 = await fetchWithRegistryClient<any>('https://registry.npmjs.org/test-pkg/latest');
    expect(res1).toEqual({ version: '1.2.3' });
    expect(spy).toHaveBeenCalledOnce();

    // Second fetch should hit the local cache and NOT invoke axios
    const res2 = await fetchWithRegistryClient<any>('https://registry.npmjs.org/test-pkg/latest');
    expect(res2).toEqual({ version: '1.2.3' });
    expect(spy).toHaveBeenCalledOnce();
  });

  it('respects cache expiration TTL', async () => {
    const spy = vi.spyOn(axios, 'get').mockResolvedValue({ data: { version: '1.2.3' } });
    await fetchWithRegistryClient<any>('https://registry.npmjs.org/test-pkg/latest');

    // Locate the cache file and set its timestamp to 13 hours ago (expired)
    const cacheDir = path.join(tempHome, '.devbrief', 'registry-cache');
    const files = fs.readdirSync(cacheDir);
    expect(files.length).toBe(1);
    const cacheFilePath = path.join(cacheDir, files[0]!);

    const content = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
    content.timestamp = Date.now() - 13 * 60 * 60 * 1000;
    fs.writeFileSync(cacheFilePath, JSON.stringify(content), 'utf-8');

    // Fetch again; since it has expired, it should trigger axios
    spy.mockResolvedValue({ data: { version: '1.2.4' } });
    const res = await fetchWithRegistryClient<any>('https://registry.npmjs.org/test-pkg/latest');
    expect(res).toEqual({ version: '1.2.4' });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('obeys the DEVBRIEF_OFFLINE policy and degrades gracefully', async () => {
    const spy = vi.spyOn(axios, 'get');
    process.env.DEVBRIEF_OFFLINE = '1';

    // 1. Without cache, should return undefined immediately and not call axios
    const resOfflineEmpty = await fetchWithRegistryClient<any>('https://registry.npmjs.org/test-pkg/latest');
    expect(resOfflineEmpty).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();

    // 2. Write expired cache, should return expired cache when offline
    process.env.DEVBRIEF_OFFLINE = '0';
    spy.mockResolvedValue({ data: { version: 'cached-offline' } });
    await fetchWithRegistryClient<any>('https://registry.npmjs.org/test-pkg/latest');

    const cacheDir = path.join(tempHome, '.devbrief', 'registry-cache');
    const files = fs.readdirSync(cacheDir);
    const cacheFilePath = path.join(cacheDir, files[0]!);
    const content = JSON.parse(fs.readFileSync(cacheFilePath, 'utf-8'));
    content.timestamp = Date.now() - 24 * 60 * 60 * 1000; // expired
    fs.writeFileSync(cacheFilePath, JSON.stringify(content), 'utf-8');

    // Switch back to offline, should retrieve the expired cache
    process.env.DEVBRIEF_OFFLINE = '1';
    const resOfflineCached = await fetchWithRegistryClient<any>('https://registry.npmjs.org/test-pkg/latest');
    expect(resOfflineCached).toEqual({ version: 'cached-offline' });
    expect(spy).toHaveBeenCalledOnce();
  });

  it('retries transient 5xx errors and network failures with exponential backoff', async () => {
    let callCount = 0;
    const spy = vi.spyOn(axios, 'get').mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error('Internal Server Error (500)');
      }
      return { data: { version: 'recovered' } };
    });

    const res = await fetchWithRegistryClient<any>('https://registry.npmjs.org/test-pkg/latest');
    expect(res).toEqual({ version: 'recovered' });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('aborts immediately and does not retry 4xx errors (except 429)', async () => {
    const spy = vi.spyOn(axios, 'get').mockRejectedValue({
      response: { status: 404, statusText: 'Not Found' },
      message: 'Request failed with status code 404',
    });

    const res = await fetchWithRegistryClient<any>('https://registry.npmjs.org/non-existent-pkg/latest');
    expect(res).toBeUndefined();
    expect(spy).toHaveBeenCalledOnce(); // No retries
  });

  it('limits outbound concurrency to at most 5 parallel operations', async () => {
    let pendingCount = 0;
    let maxConcurrent = 0;

    vi.spyOn(axios, 'get').mockImplementation(async () => {
      pendingCount++;
      maxConcurrent = Math.max(maxConcurrent, pendingCount);
      await new Promise((resolve) => setTimeout(resolve, 50));
      pendingCount--;
      return { data: { version: 'concurrency-test' } };
    });

    // Fire 10 requests concurrently
    const promises = Array.from({ length: 10 }).map((_, i) =>
      fetchWithRegistryClient<any>(`https://registry.npmjs.org/pkg-${i}/latest`)
    );

    await Promise.all(promises);
    expect(maxConcurrent).toBeLessThanOrEqual(5);
  });
});
