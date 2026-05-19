/**
 * HydraDB REST client for DevBrief.
 *
 * Stores change entries and run summaries as knowledge items in HydraDB,
 * providing persistent cloud storage and semantic recall capabilities.
 *
 * API Reference: https://docs.usecortex.ai
 * - Store knowledge: POST /ingestion/upload_knowledge (multipart form with app_knowledge)
 * - List/query: POST /list/data (JSON body with tenant_id, kind, filters)
 *
 * Falls back gracefully to SQLite-only mode if HYDRADB_API_KEY is not set.
 */

import axios, { type AxiosInstance } from 'axios';
import type { ChangeEntry } from '../models/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HYDRADB_BASE_URL = 'https://api.hydradb.com';

export interface HydraDBConfig {
  apiKey: string;
  tenantId: string;
}

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let clientInstance: HydraDBClient | null = null;
let warnedOnce = false;

/**
 * Returns a configured HydraDB client, or null if credentials are not set.
 * Logs a warning on first call if credentials are missing.
 */
export function getHydraDBClient(): HydraDBClient | null {
  const apiKey = process.env.HYDRADB_API_KEY;
  const tenantId = process.env.HYDRADB_TENANT_ID;

  if (!apiKey || !tenantId) {
    if (!warnedOnce) {
      console.warn(
        '[hydradb] HYDRADB_API_KEY or HYDRADB_TENANT_ID not set — falling back to SQLite-only mode.',
      );
      warnedOnce = true;
    }
    return null;
  }

  if (!clientInstance) {
    clientInstance = new HydraDBClient({ apiKey, tenantId });
  }

  return clientInstance;
}

/**
 * Resets the client singleton. Useful for tests.
 */
export function resetHydraDBClient(): void {
  clientInstance = null;
  warnedOnce = false;
}

// ---------------------------------------------------------------------------
// Client class
// ---------------------------------------------------------------------------

export class HydraDBClient {
  private http: AxiosInstance;
  private tenantId: string;

  constructor(config: HydraDBConfig) {
    this.tenantId = config.tenantId;
    this.http = axios.create({
      baseURL: HYDRADB_BASE_URL,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      timeout: 15000,
    });
  }

  /**
   * Stores a classified change entry as a knowledge item in HydraDB
   * using the app_knowledge upload endpoint.
   *
   * Endpoint: POST /ingestion/upload_knowledge
   * Format: multipart/form-data with app_knowledge JSON field
   */
  async storeChangeEntry(entry: ChangeEntry): Promise<void> {
    try {
      const appKnowledge = [
        {
          id: entry.entry_id,
          tenant_id: this.tenantId,
          sub_tenant_id: 'devbrief',
          title: `${entry.library_name}@${entry.version}`,
          source: 'devbrief',
          description: entry.summary ?? `Change entry for ${entry.library_name} ${entry.version}`,
          url: entry.source_url,
          timestamp: entry.scraped_at,
          content: {
            text: entry.raw_content.slice(0, 5000), // Limit content size
          },
          metadata: {
            type: 'change_entry',
            library_name: entry.library_name,
            version: entry.version,
            classification: entry.classification ?? 'unknown',
          },
          additional_metadata: {
            run_id: entry.run_id,
            confidence_flag: String(entry.confidence_flag),
            scraped_at: entry.scraped_at,
          },
        },
      ];

      const formData = new FormData();
      formData.append('tenant_id', this.tenantId);
      formData.append('sub_tenant_id', 'devbrief');
      formData.append('app_knowledge', JSON.stringify(appKnowledge));

      await this.http.post('/ingestion/upload_knowledge', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[hydradb] Failed to store entry ${entry.entry_id}: ${message}`);
      // Non-fatal — don't throw, just log
    }
  }

  /**
   * Stores multiple change entries in HydraDB as a single batch upload.
   */
  async storeChangeEntries(entries: ChangeEntry[]): Promise<void> {
    if (entries.length === 0) return;

    try {
      const appKnowledge = entries.map((entry) => ({
        id: entry.entry_id,
        tenant_id: this.tenantId,
        sub_tenant_id: 'devbrief',
        title: `${entry.library_name}@${entry.version}`,
        source: 'devbrief',
        description: entry.summary ?? `Change entry for ${entry.library_name} ${entry.version}`,
        url: entry.source_url,
        timestamp: entry.scraped_at,
        content: {
          text: entry.raw_content.slice(0, 5000),
        },
        metadata: {
          type: 'change_entry',
          library_name: entry.library_name,
          version: entry.version,
          classification: entry.classification ?? 'unknown',
        },
        additional_metadata: {
          run_id: entry.run_id,
          confidence_flag: String(entry.confidence_flag),
          scraped_at: entry.scraped_at,
        },
      }));

      const formData = new FormData();
      formData.append('tenant_id', this.tenantId);
      formData.append('sub_tenant_id', 'devbrief');
      formData.append('app_knowledge', JSON.stringify(appKnowledge));

      await this.http.post('/ingestion/upload_knowledge', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      console.log(`[hydradb] Stored ${entries.length} entries successfully`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[hydradb] Failed to store ${entries.length} entries: ${message}`);
      // Non-fatal — don't throw, just log
    }
  }

  /**
   * Queries HydraDB for existing entries matching a library name.
   * Uses POST /list/data with metadata filters.
   *
   * @returns true if matching entries exist, false otherwise.
   */
  async entryExists(libraryName: string, version: string): Promise<boolean> {
    try {
      const response = await this.http.post(
        '/list/data',
        {
          tenant_id: this.tenantId,
          sub_tenant_id: 'devbrief',
          kind: 'knowledge',
          page: 1,
          page_size: 1,
          filters: {
            tenant_metadata: {
              library_name: libraryName,
              version: version,
            },
          },
          include_fields: ['title'],
        },
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );

      const total = response.data?.total ?? 0;
      return total > 0;
    } catch (err) {
      // Non-fatal — if query fails, fall back to SQLite dedup
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[hydradb] Query failed for ${libraryName}@${version}: ${message}`);
      return false;
    }
  }

  /**
   * Stores a run summary as a knowledge item for future semantic recall.
   */
  async storeRunSummary(
    runId: string,
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      const appKnowledge = [
        {
          id: `run_${runId}`,
          tenant_id: this.tenantId,
          sub_tenant_id: 'devbrief',
          title: `DevBrief Run ${runId.slice(0, 8)}`,
          source: 'devbrief',
          description: `Pipeline run summary`,
          timestamp: new Date().toISOString(),
          content: {
            text: summary,
          },
          metadata: {
            type: 'run_summary',
            run_id: runId,
            ...(metadata as Record<string, string>),
          },
        },
      ];

      const formData = new FormData();
      formData.append('tenant_id', this.tenantId);
      formData.append('sub_tenant_id', 'devbrief');
      formData.append('app_knowledge', JSON.stringify(appKnowledge));

      await this.http.post('/ingestion/upload_knowledge', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[hydradb] Failed to store run summary ${runId}: ${message}`);
    }
  }
}
