import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export type DB = DatabaseSync;

// Loaded lazily with require() rather than a static import so that the ExperimentalWarning
// filter in quiet.ts is installed first: static ESM imports of builtins resolve before any
// module code runs.
const require = createRequire(import.meta.url);

function loadSqlite(): typeof import('node:sqlite') {
  try {
    return require('node:sqlite') as typeof import('node:sqlite');
  } catch {
    throw new Error(
      `internBuddy needs Node.js 22.13 or newer for its built-in SQLite (you have ${process.version}). ` +
        'Install the current LTS from https://nodejs.org and try again.',
    );
  }
}

const MIGRATIONS: string[] = [
  // v1
  `
  CREATE TABLE companies (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    domain        TEXT,
    ats           TEXT,
    ats_token     TEXT,
    careers_url   TEXT,
    hq_city       TEXT,
    status        TEXT NOT NULL DEFAULT 'unresolved',
    source        TEXT,
    last_ok_at    TEXT,
    fail_count    INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    etag          TEXT,
    last_modified TEXT,
    created_at    TEXT NOT NULL
  );
  CREATE UNIQUE INDEX companies_board ON companies(ats, ats_token) WHERE ats_token IS NOT NULL;
  CREATE INDEX companies_status ON companies(status);

  -- Only student roles (and new-grad roles, tagged) are stored; everything else is dropped at
  -- ingest. ATS job ids are unique per ATS, which is what makes "new since last run" work.
  CREATE TABLE jobs (
    id              INTEGER PRIMARY KEY,
    company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    company         TEXT NOT NULL,
    ats             TEXT NOT NULL,
    ats_job_id      TEXT NOT NULL,
    kind            TEXT NOT NULL,
    title           TEXT NOT NULL,
    location        TEXT NOT NULL DEFAULT '',
    url             TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    departments     TEXT NOT NULL DEFAULT '[]',
    employment_type TEXT,
    remote          INTEGER,
    posted_at       TEXT,
    first_seen_at   TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL,
    is_open         INTEGER NOT NULL DEFAULT 1,
    UNIQUE (ats, ats_job_id)
  );
  CREATE INDEX jobs_open_kind ON jobs(is_open, kind);
  CREATE INDEX jobs_company ON jobs(company_id);
  CREATE INDEX jobs_first_seen ON jobs(first_seen_at);

  -- "Seen" means shown to you in an interactive surface. The daily scout never marks
  -- anything seen, so a cron run can't swallow postings before you look at them.
  CREATE TABLE seen (
    job_id   INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    shown_at TEXT NOT NULL
  );

  CREATE TABLE status (
    job_id     INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    state      TEXT NOT NULL,
    notes      TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE runs (
    id          INTEGER PRIMARY KEY,
    kind        TEXT NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    summary     TEXT
  );
  `,
];

export function openDb(file: string): DB {
  const { DatabaseSync } = loadSqlite();
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL + busy_timeout: the daily CLI run and the MCP server can safely write at the same time.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v] as string);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getSetting(db: DB, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}
