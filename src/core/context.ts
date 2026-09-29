import { HttpClient } from './ats/client.js';
import { type DB, openDb } from './db.js';
import { DeterministicRanker, type Ranker } from './match/rank.js';
import { resolvePaths, type Paths } from './paths.js';
import { type LoadedProfile, loadProfile } from './profile.js';
import { syncRegistryFile } from './registry.js';

/** Everything a face (CLI, MCP, later the web UI) needs. Faces hold no logic of their own. */
export interface Ctx {
  db: DB;
  paths: Paths;
  http: HttpClient;
  ranker: Ranker;
  /** Re-read on every call, so edits to the profile file apply without a restart. */
  profile(): LoadedProfile;
  close(): void;
}

export interface ContextOptions {
  env?: NodeJS.ProcessEnv;
  dbFile?: string;
  http?: HttpClient;
  /** Sync data/companies.csv into the database on open (default true). */
  syncRegistry?: boolean;
}

export function openContext(opts: ContextOptions = {}): Ctx {
  const paths = resolvePaths(opts.env);
  const db = openDb(opts.dbFile ?? paths.db);
  if (opts.syncRegistry !== false) syncRegistryFile(db, paths.registryCsv);
  return {
    db,
    paths,
    http: opts.http ?? new HttpClient(),
    ranker: new DeterministicRanker(),
    profile: () => loadProfile(paths.profile),
    close: () => db.close(),
  };
}
