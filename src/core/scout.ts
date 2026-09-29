import { ADAPTERS, SUPPORTED_ATS } from './ats/index.js';
import { errorMessage, type HttpClient, mapPool } from './ats/client.js';
import type { DB } from './db.js';
import { classifyRole } from './match/classify.js';
import {
  type ClassifiedJob,
  companiesToFetch,
  finishRun,
  getCompany,
  ingestJobs,
  nowIso,
  recordFetchFailure,
  recordFetchOk,
  startRun,
  touchOpenJobs,
} from './store.js';
import type { Ats, Company } from './types.js';

export interface ScoutProgress {
  done: number;
  total: number;
  company: string;
}

export interface ScoutOptions {
  /** Fetch at most this many boards (least recently fetched first). */
  limit?: number;
  /** Fetch exactly these companies instead. */
  companyIds?: number[];
  concurrency?: number;
  onProgress?: (p: ScoutProgress) => void;
}

export interface ScoutReport {
  startedAt: string;
  finishedAt: string;
  boards: number;
  ok: number;
  unchanged: number;
  failed: { company: string; error: string }[];
  disabled: string[];
  /** Every posting on every board fetched, before filtering. */
  postingsSeen: number;
  /** Open student roles on the boards fetched. */
  studentRoles: number;
  newGradRoles: number;
  /** Postings stored for the first time in this run. */
  newJobIds: number[];
  closed: number;
}

/**
 * Fetch boards, keep the student roles, store them, and close the ones that disappeared.
 * Never throws for a single bad board: failures are collected into the report, and a board
 * that fails three runs in a row is disabled.
 */
export async function scout(ctx: { db: DB; http: HttpClient }, opts: ScoutOptions = {}): Promise<ScoutReport> {
  const { db, http } = ctx;
  const startedAt = nowIso();
  const runId = startRun(db, 'scout', startedAt);

  const companies: Company[] = opts.companyIds?.length
    ? opts.companyIds.map((id) => getCompany(db, id)).filter((c): c is Company => !!c && !!c.atsToken && c.ats! in ADAPTERS)
    : companiesToFetch(db, SUPPORTED_ATS, opts.limit);

  const report: ScoutReport = {
    startedAt, finishedAt: startedAt, boards: companies.length, ok: 0, unchanged: 0, failed: [], disabled: [],
    postingsSeen: 0, studentRoles: 0, newGradRoles: 0, newJobIds: [], closed: 0,
  };

  // A board that has worked before gets three strikes (it may be a blip). One that has never
  // worked and answers 404 is simply wrong or gone.
  const fail = (c: Company, error: string, status = 0) => {
    report.failed.push({ company: c.name, error });
    const disableAfter = status === 404 && !c.lastOkAt ? 1 : 3;
    if (recordFetchFailure(db, c.id, error, disableAfter)) report.disabled.push(c.name);
  };

  let done = 0;
  await mapPool(companies, opts.concurrency ?? 8, async (c) => {
    const adapter = ADAPTERS[c.ats as Ats];
    const token = c.atsToken as string;
    try {
      const res = await http.get(adapter.boardApiUrl(token), { etag: c.etag, lastModified: c.lastModified });
      if (res.ok && res.notModified) {
        const now = nowIso();
        touchOpenJobs(db, c.id, now);
        recordFetchOk(db, c.id, { etag: res.etag, lastModified: res.lastModified }, now);
        report.unchanged++;
        return;
      }
      if (!res.ok) {
        fail(
          c,
          res.status === 404 ? 'board not found (404): the token may be wrong or the board removed' : (res.error ?? 'failed'),
          res.status,
        );
        return;
      }
      const parsed = adapter.parse(res.body, c.name);
      report.postingsSeen += parsed.length;
      const kept: ClassifiedJob[] = [];
      for (const j of parsed) {
        const kind = classifyRole(j.title, j.employmentType);
        if (kind === 'other') continue;
        kept.push({ ...j, kind });
        if (kind === 'internship') report.studentRoles++;
        else report.newGradRoles++;
      }
      const now = nowIso();
      const result = ingestJobs(db, c, kept, now);
      report.newJobIds.push(...result.insertedIds);
      report.closed += result.closed;
      recordFetchOk(db, c.id, { etag: res.etag, lastModified: res.lastModified }, now);
      report.ok++;
    } catch (err) {
      fail(c, errorMessage(err));
    } finally {
      done++;
      opts.onProgress?.({ done, total: companies.length, company: c.name });
    }
  });

  report.finishedAt = nowIso();
  finishRun(db, runId, { ...report, newJobIds: report.newJobIds.length }, report.finishedAt);
  return report;
}
