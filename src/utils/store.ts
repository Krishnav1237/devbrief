import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import type { ChangeEntry } from '../models/index.js';
import type { RunRecord, StepError } from '../models/index.js';

// ---------------------------------------------------------------------------
// Database path
// ---------------------------------------------------------------------------

const DEVBRIEF_DIR = path.join(os.homedir(), '.devbrief');
const DB_PATH = path.join(DEVBRIEF_DIR, 'devbrief.db');

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

let db: Database.Database | null = null;

/**
 * Returns the singleton database instance, creating it and the tables
 * if they don't already exist.
 */
export function initStore(dbPath?: string): Database.Database {
  if (db) return db;

  const resolvedPath = dbPath ?? DB_PATH;
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS change_entries (
      entry_id       TEXT PRIMARY KEY,
      run_id         TEXT NOT NULL,
      library_name   TEXT NOT NULL,
      version        TEXT NOT NULL,
      source_url     TEXT NOT NULL,
      raw_content    TEXT NOT NULL,
      classification TEXT,
      summary        TEXT,
      confidence_flag INTEGER NOT NULL DEFAULT 0,
      scraped_at     TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ce_library
      ON change_entries(library_name);

    CREATE INDEX IF NOT EXISTS idx_ce_run
      ON change_entries(run_id);

    CREATE TABLE IF NOT EXISTS run_records (
      run_id              TEXT PRIMARY KEY,
      triggered_at        TEXT NOT NULL,
      trigger_type        TEXT NOT NULL,
      status              TEXT NOT NULL,
      has_errors          INTEGER NOT NULL DEFAULT 0,
      libraries_processed TEXT NOT NULL DEFAULT '[]',
      new_change_count    INTEGER NOT NULL DEFAULT 0,
      briefing_script     TEXT,
      audio_url           TEXT,
      digest_link         TEXT,
      errors              TEXT NOT NULL DEFAULT '[]',
      completed_at        TEXT
    );
  `);

  return db;
}

/**
 * Returns the current database instance. Throws if not initialized.
 */
export function getStore(): Database.Database {
  if (!db) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return db;
}

/**
 * Closes the database connection and resets the singleton.
 * Useful for tests.
 */
export function closeStore(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ---------------------------------------------------------------------------
// Change_Entry operations
// ---------------------------------------------------------------------------

/**
 * Returns all stored change entries for a given library name.
 */
export function getExistingEntriesForLibrary(libraryName: string): ChangeEntry[] {
  const store = getStore();
  const rows = store
    .prepare('SELECT * FROM change_entries WHERE library_name = ?')
    .all(libraryName) as Array<Record<string, unknown>>;

  return rows.map(rowToChangeEntry);
}

/**
 * Inserts an array of change entries into the store.
 */
export function storeEntries(entries: ChangeEntry[]): void {
  const store = getStore();
  const insert = store.prepare(`
    INSERT OR IGNORE INTO change_entries
      (entry_id, run_id, library_name, version, source_url, raw_content,
       classification, summary, confidence_flag, scraped_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = store.transaction((items: ChangeEntry[]) => {
    for (const e of items) {
      insert.run(
        e.entry_id,
        e.run_id,
        e.library_name,
        e.version,
        e.source_url,
        e.raw_content,
        e.classification,
        e.summary,
        e.confidence_flag ? 1 : 0,
        e.scraped_at,
      );
    }
  });

  tx(entries);
}

/**
 * Updates the classification, summary, and confidence_flag for a change entry.
 */
export function updateEntryClassification(
  entryId: string,
  classification: string,
  summary: string,
  confidenceFlag: boolean,
): void {
  const store = getStore();
  store
    .prepare(
      `UPDATE change_entries
       SET classification = ?, summary = ?, confidence_flag = ?
       WHERE entry_id = ?`,
    )
    .run(classification, summary, confidenceFlag ? 1 : 0, entryId);
}

// ---------------------------------------------------------------------------
// Run_Record operations
// ---------------------------------------------------------------------------

/**
 * Creates a new run record.
 */
export function storeRunRecord(record: RunRecord): void {
  const store = getStore();
  store
    .prepare(
      `INSERT INTO run_records
        (run_id, triggered_at, trigger_type, status, has_errors,
         libraries_processed, new_change_count, briefing_script,
         audio_url, digest_link, errors, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.run_id,
      record.triggered_at,
      record.trigger_type,
      record.status,
      record.has_errors ? 1 : 0,
      JSON.stringify(record.libraries_processed),
      record.new_change_count,
      record.briefing_script,
      record.audio_url,
      record.digest_link,
      JSON.stringify(record.errors),
      record.completed_at,
    );
}

/**
 * Updates an existing run record.
 */
export function updateRunRecord(record: RunRecord): void {
  const store = getStore();
  store
    .prepare(
      `UPDATE run_records SET
        triggered_at = ?, trigger_type = ?, status = ?, has_errors = ?,
        libraries_processed = ?, new_change_count = ?, briefing_script = ?,
        audio_url = ?, digest_link = ?, errors = ?, completed_at = ?
       WHERE run_id = ?`,
    )
    .run(
      record.triggered_at,
      record.trigger_type,
      record.status,
      record.has_errors ? 1 : 0,
      JSON.stringify(record.libraries_processed),
      record.new_change_count,
      record.briefing_script,
      record.audio_url,
      record.digest_link,
      JSON.stringify(record.errors),
      record.completed_at,
      record.run_id,
    );
}

/**
 * Returns all run records, ordered by triggered_at descending.
 */
export function getRunRecords(): RunRecord[] {
  const store = getStore();
  const rows = store
    .prepare('SELECT * FROM run_records ORDER BY triggered_at DESC')
    .all() as Array<Record<string, unknown>>;

  return rows.map(rowToRunRecord);
}

/**
 * Returns a single run record by ID, or null if not found.
 */
export function getRunRecord(runId: string): RunRecord | null {
  const store = getStore();
  const row = store
    .prepare('SELECT * FROM run_records WHERE run_id = ?')
    .get(runId) as Record<string, unknown> | undefined;

  return row ? rowToRunRecord(row) : null;
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToChangeEntry(row: Record<string, unknown>): ChangeEntry {
  return {
    entry_id: row.entry_id as string,
    run_id: row.run_id as string,
    library_name: row.library_name as string,
    version: row.version as string,
    source_url: row.source_url as string,
    raw_content: row.raw_content as string,
    classification: (row.classification as ChangeEntry['classification']) ?? null,
    summary: (row.summary as string) ?? null,
    confidence_flag: row.confidence_flag === 1,
    scraped_at: row.scraped_at as string,
  };
}

function rowToRunRecord(row: Record<string, unknown>): RunRecord {
  return {
    run_id: row.run_id as string,
    triggered_at: row.triggered_at as string,
    trigger_type: row.trigger_type as RunRecord['trigger_type'],
    status: row.status as RunRecord['status'],
    has_errors: row.has_errors === 1,
    libraries_processed: JSON.parse(row.libraries_processed as string) as string[],
    new_change_count: row.new_change_count as number,
    briefing_script: (row.briefing_script as string) ?? null,
    audio_url: (row.audio_url as string) ?? null,
    digest_link: (row.digest_link as string) ?? null,
    errors: JSON.parse(row.errors as string) as StepError[],
    completed_at: (row.completed_at as string) ?? null,
  };
}
