import { type DB, tx } from './db.js';
import type { Company, CompanyStatus, JobKind, NormalizedJob, StoredJob, TrackState } from './types.js';

type Row = Record<string, unknown>;

export function nowIso(d: Date = new Date()): string {
  return d.toISOString();
}

// ---------------------------------------------------------------- companies

function toCompany(r: Row): Company {
  return {
    id: Number(r.id),
    name: String(r.name),
    domain: (r.domain as string | null) ?? null,
    ats: (r.ats as string | null) ?? null,
    atsToken: (r.ats_token as string | null) ?? null,
    careersUrl: (r.careers_url as string | null) ?? null,
    hqCity: (r.hq_city as string | null) ?? null,
    status: r.status as CompanyStatus,
    source: (r.source as string | null) ?? null,
    lastOkAt: (r.last_ok_at as string | null) ?? null,
    failCount: Number(r.fail_count ?? 0),
    lastError: (r.last_error as string | null) ?? null,
    etag: (r.etag as string | null) ?? null,
    lastModified: (r.last_modified as string | null) ?? null,
  };
}

export interface NewCompany {
  name: string;
  domain?: string | null;
  ats?: string | null;
  atsToken?: string | null;
  careersUrl?: string | null;
  hqCity?: string | null;
  status?: CompanyStatus;
  source?: string | null;
}

export function insertCompany(db: DB, c: NewCompany, now = nowIso()): number {
  const res = db
    .prepare(
      `INSERT INTO companies (name, domain, ats, ats_token, careers_url, hq_city, status, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.name,
      c.domain ?? null,
      c.ats ?? null,
      c.atsToken ?? null,
      c.careersUrl ?? null,
      c.hqCity ?? null,
      c.status ?? (c.atsToken ? 'active' : 'unresolved'),
      c.source ?? null,
      now,
    );
  return Number(res.lastInsertRowid);
}

const COMPANY_COLUMNS: Record<string, string> = {
  name: 'name', domain: 'domain', ats: 'ats', atsToken: 'ats_token', careersUrl: 'careers_url',
  hqCity: 'hq_city', status: 'status', source: 'source', failCount: 'fail_count', lastError: 'last_error',
};

export function updateCompany(db: DB, id: number, patch: Partial<Omit<Company, 'id'>>): void {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const col = COMPANY_COLUMNS[key];
    if (!col || value === undefined) continue;
    sets.push(`${col} = ?`);
    values.push(value as string | number | null);
  }
  if (!sets.length) return;
  db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
}

export function getCompany(db: DB, id: number): Company | null {
  const r = db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as Row | undefined;
  return r ? toCompany(r) : null;
}

export function findCompanyByBoard(db: DB, ats: string, token: string): Company | null {
  const r = db
    .prepare('SELECT * FROM companies WHERE ats = ? AND lower(ats_token) = lower(?)')
    .get(ats, token) as Row | undefined;
  return r ? toCompany(r) : null;
}

export function listCompanies(db: DB, statuses?: CompanyStatus[]): Company[] {
  const rows = statuses?.length
    ? (db
        .prepare(`SELECT * FROM companies WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY name COLLATE NOCASE`)
        .all(...statuses) as Row[])
    : (db.prepare('SELECT * FROM companies ORDER BY name COLLATE NOCASE').all() as Row[]);
  return rows.map(toCompany);
}

/** Active boards we know how to fetch, least-recently-fetched first. */
export function companiesToFetch(db: DB, supportedAts: readonly string[], limit?: number): Company[] {
  const rows = db
    .prepare(
      `SELECT * FROM companies
       WHERE status = 'active' AND ats_token IS NOT NULL AND ats IN (${supportedAts.map(() => '?').join(',')})
       ORDER BY last_ok_at IS NOT NULL, last_ok_at, name COLLATE NOCASE
       ${limit ? 'LIMIT ?' : ''}`,
    )
    .all(...supportedAts, ...(limit ? [limit] : [])) as Row[];
  return rows.map(toCompany);
}

export function companyStatusCounts(db: DB): Record<string, number> {
  const rows = db.prepare('SELECT status, count(*) AS n FROM companies GROUP BY status').all() as Row[];
  return Object.fromEntries(rows.map((r) => [String(r.status), Number(r.n)]));
}

export function recordFetchOk(
  db: DB,
  id: number,
  cache: { etag: string | null; lastModified: string | null },
  now = nowIso(),
): void {
  db.prepare(
    `UPDATE companies SET last_ok_at = ?, fail_count = 0, last_error = NULL, etag = ?, last_modified = ? WHERE id = ?`,
  ).run(now, cache.etag, cache.lastModified, id);
}

/** Returns true when this failure disabled the board. */
export function recordFetchFailure(db: DB, id: number, error: string, disableAfter = 3): boolean {
  db.prepare('UPDATE companies SET fail_count = fail_count + 1, last_error = ? WHERE id = ?').run(error, id);
  const r = db.prepare('SELECT fail_count FROM companies WHERE id = ?').get(id) as Row;
  if (Number(r.fail_count) >= disableAfter) {
    db.prepare(`UPDATE companies SET status = 'disabled' WHERE id = ?`).run(id);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- jobs

export type ClassifiedJob = NormalizedJob & { kind: JobKind };

export interface IngestResult {
  insertedIds: number[];
  updated: number;
  closed: number;
}

/**
 * Upsert one board's student roles and close the ones that disappeared from it. Only call this
 * after a successful fetch: an empty list here means "the board has no openings", and every
 * open job for the company gets closed.
 */
export function ingestJobs(db: DB, company: Company, jobs: ClassifiedJob[], now = nowIso()): IngestResult {
  const ats = company.ats ?? 'unknown';
  const find = db.prepare('SELECT id FROM jobs WHERE ats = ? AND ats_job_id = ?');
  const insert = db.prepare(
    `INSERT INTO jobs (company_id, company, ats, ats_job_id, kind, title, location, url, description,
                       departments, employment_type, remote, posted_at, first_seen_at, last_seen_at, is_open)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const update = db.prepare(
    `UPDATE jobs SET company_id = ?, company = ?, kind = ?, title = ?, location = ?, url = ?, description = ?,
                     departments = ?, employment_type = ?, remote = ?, posted_at = ?, last_seen_at = ?, is_open = 1
     WHERE id = ?`,
  );

  return tx(db, () => {
    const insertedIds: number[] = [];
    let updated = 0;
    for (const j of jobs) {
      const remote = j.remote === null ? null : j.remote ? 1 : 0;
      const departments = JSON.stringify(j.departments);
      const existing = find.get(ats, j.atsJobId) as Row | undefined;
      if (existing) {
        update.run(
          company.id, company.name, j.kind, j.title, j.location, j.url, j.description,
          departments, j.employmentType, remote, j.postedAt, now, Number(existing.id),
        );
        updated++;
      } else {
        const res = insert.run(
          company.id, company.name, ats, j.atsJobId, j.kind, j.title, j.location, j.url, j.description,
          departments, j.employmentType, remote, j.postedAt, now, now,
        );
        insertedIds.push(Number(res.lastInsertRowid));
      }
    }
    const closed = db
      .prepare('UPDATE jobs SET is_open = 0 WHERE company_id = ? AND is_open = 1 AND last_seen_at < ?')
      .run(company.id, now);
    return { insertedIds, updated, closed: Number(closed.changes) };
  });
}

/** A 304 means the board is unchanged: keep its jobs open. */
export function touchOpenJobs(db: DB, companyId: number, now = nowIso()): void {
  db.prepare('UPDATE jobs SET last_seen_at = ? WHERE company_id = ? AND is_open = 1').run(now, companyId);
}

const JOB_SELECT = `
  SELECT j.*, s.shown_at, st.state, st.notes
  FROM jobs j
  LEFT JOIN seen s ON s.job_id = j.id
  LEFT JOIN status st ON st.job_id = j.id`;

function toJob(r: Row): StoredJob {
  let departments: string[] = [];
  try {
    departments = JSON.parse(String(r.departments ?? '[]')) as string[];
  } catch {
    departments = [];
  }
  return {
    id: Number(r.id),
    kind: r.kind as JobKind,
    companyId: Number(r.company_id),
    company: String(r.company),
    ats: String(r.ats),
    atsJobId: String(r.ats_job_id),
    title: String(r.title),
    location: String(r.location ?? ''),
    url: String(r.url ?? ''),
    description: String(r.description ?? ''),
    postedAt: (r.posted_at as string | null) ?? null,
    firstSeenAt: String(r.first_seen_at),
    lastSeenAt: String(r.last_seen_at),
    isOpen: Number(r.is_open) === 1,
    remote: r.remote === null || r.remote === undefined ? null : Number(r.remote) === 1,
    employmentType: (r.employment_type as string | null) ?? null,
    departments,
    seen: r.shown_at != null,
    state: (r.state as TrackState | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  };
}

export interface JobQuery {
  kinds: JobKind[];
  includeSeen?: boolean;
  openOnly?: boolean;
  ids?: number[];
  /** Only jobs with a tracking state (any state, or the one given). */
  tracked?: TrackState | true;
}

export function queryJobs(db: DB, q: JobQuery): StoredJob[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (q.kinds.length) {
    where.push(`j.kind IN (${q.kinds.map(() => '?').join(',')})`);
    params.push(...q.kinds);
  }
  if (q.openOnly !== false) where.push('j.is_open = 1');
  if (!q.includeSeen) where.push('s.job_id IS NULL');
  if (q.ids?.length) {
    where.push(`j.id IN (${q.ids.map(() => '?').join(',')})`);
    params.push(...q.ids);
  }
  if (q.tracked === true) where.push('st.state IS NOT NULL');
  else if (q.tracked) {
    where.push('st.state = ?');
    params.push(q.tracked);
  }
  const sql = `${JOB_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  return (db.prepare(sql).all(...params) as Row[]).map(toJob);
}

export function getJob(db: DB, id: number): StoredJob | null {
  const r = db.prepare(`${JOB_SELECT} WHERE j.id = ?`).get(id) as Row | undefined;
  return r ? toJob(r) : null;
}

export function markSeen(db: DB, ids: number[], now = nowIso()): void {
  if (!ids.length) return;
  const stmt = db.prepare('INSERT OR IGNORE INTO seen (job_id, shown_at) VALUES (?, ?)');
  tx(db, () => {
    for (const id of ids) stmt.run(id, now);
  });
}

export function setTrackState(db: DB, id: number, state: TrackState, notes: string | null, now = nowIso()): void {
  db.prepare(
    `INSERT INTO status (job_id, state, notes, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET state = excluded.state,
       notes = COALESCE(excluded.notes, status.notes), updated_at = excluded.updated_at`,
  ).run(id, state, notes, now);
}

export function jobCounts(db: DB): { open: number; internshipsOpen: number; unseen: number; tracked: number } {
  const r = db
    .prepare(
      `SELECT
         (SELECT count(*) FROM jobs WHERE is_open = 1) AS open,
         (SELECT count(*) FROM jobs WHERE is_open = 1 AND kind = 'internship') AS internships_open,
         (SELECT count(*) FROM jobs j LEFT JOIN seen s ON s.job_id = j.id WHERE j.is_open = 1 AND s.job_id IS NULL) AS unseen,
         (SELECT count(*) FROM status) AS tracked`,
    )
    .get() as Row;
  return {
    open: Number(r.open),
    internshipsOpen: Number(r.internships_open),
    unseen: Number(r.unseen),
    tracked: Number(r.tracked),
  };
}

// ---------------------------------------------------------------- runs

export function startRun(db: DB, kind: string, now = nowIso()): number {
  return Number(db.prepare('INSERT INTO runs (kind, started_at) VALUES (?, ?)').run(kind, now).lastInsertRowid);
}

export function finishRun(db: DB, id: number, summary: unknown, now = nowIso()): void {
  db.prepare('UPDATE runs SET finished_at = ?, summary = ? WHERE id = ?').run(now, JSON.stringify(summary), id);
}

export function lastRun(db: DB, kind: string): { startedAt: string; finishedAt: string | null; summary: unknown } | null {
  const r = db
    .prepare('SELECT * FROM runs WHERE kind = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1')
    .get(kind) as Row | undefined;
  if (!r) return null;
  return {
    startedAt: String(r.started_at),
    finishedAt: (r.finished_at as string | null) ?? null,
    summary: r.summary ? JSON.parse(String(r.summary)) : null,
  };
}
