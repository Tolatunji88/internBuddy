import { ADAPTERS, isSupportedAts } from '../ats/index.js';
import { type HttpClient, mapPool } from '../ats/client.js';
import { type DB, tx } from '../db.js';
import { findCompanyByBoard, finishRun, insertCompany, listCompanies, nowIso, startRun, updateCompany } from '../store.js';
import { companyKey } from '../text.js';
import type { Ats, Company } from '../types.js';
import { type BoardCandidate, harvestSimplify, type ListingSource } from './bootstrap.js';
import { resolveCompany } from './resolve.js';
import { RobotsCache } from './robots.js';

export interface DiscoverOptions {
  /** Harvest boards from SimplifyJobs (default true). */
  bootstrap?: boolean;
  /**
   * `canada` (default): boards that have had a Canadian posting — a couple of hundred.
   * `all`: every board in the lists — well over a thousand, and a slower daily scout.
   */
  scope?: 'canada' | 'all';
  /** Only resolve these companies (by name). */
  names?: string[];
  /** Max unresolved companies to try per run (default 150). */
  resolveLimit?: number;
  concurrency?: number;
  sources?: ListingSource[];
  onProgress?: (message: string) => void;
}

export interface DiscoverReport {
  sourcesOk: string[];
  sourceErrors: { id: string; error: string }[];
  candidates: number;
  added: number;
  upgraded: number;
  alreadyKnown: number;
  deadBoards: number;
  unsupportedRecorded: number;
  resolved: { name: string; ats: string; token: string; note: string }[];
  needsReview: { name: string; note: string }[];
  unsupported: { name: string; ats: string }[];
  stillUnresolved: string[];
}

export async function discover(ctx: { db: DB; http: HttpClient }, opts: DiscoverOptions = {}): Promise<DiscoverReport> {
  const { db, http } = ctx;
  const say = opts.onProgress ?? (() => {});
  const runId = startRun(db, 'discover');
  const report: DiscoverReport = {
    sourcesOk: [], sourceErrors: [], candidates: 0, added: 0, upgraded: 0, alreadyKnown: 0, deadBoards: 0,
    unsupportedRecorded: 0, resolved: [], needsReview: [], unsupported: [], stillUnresolved: [],
  };

  if (opts.bootstrap !== false && !opts.names?.length) {
    say('Downloading SimplifyJobs listings…');
    const harvest = await harvestSimplify(http, opts.sources);
    report.sourcesOk = harvest.sourcesOk;
    report.sourceErrors = harvest.sourceErrors;
    const scoped = opts.scope === 'all' ? harvest.candidates : harvest.candidates.filter((c) => c.canada);
    report.candidates = scoped.length;
    const fresh = scoped.filter((c) => {
      if (findCompanyByBoard(db, c.ats, c.token)) {
        report.alreadyKnown++;
        return false;
      }
      return true;
    });
    say(`${scoped.length} boards in scope, ${fresh.length} new. Checking they still exist…`);

    // Confirm supported boards still exist before adding them; record the rest for later adapters.
    let checked = 0;
    const verdicts = await mapPool(fresh, opts.concurrency ?? 8, async (c) => {
      if (!isSupportedAts(c.ats)) return 'unsupported' as const;
      const adapter = ADAPTERS[c.ats];
      const res = await http.get(adapter.probeUrl(c.token));
      if (++checked % 25 === 0) say(`  checked ${checked}/${fresh.length}`);
      if (res.ok && adapter.looksLikeBoard(res.body)) return 'active' as const;
      // Network trouble isn't evidence a board is gone; keep it and let scout decide.
      return res.status === 404 ? ('dead' as const) : ('active' as const);
    });
    tx(db, () => {
      fresh.forEach((c, i) => {
        const verdict = verdicts[i];
        if (verdict === 'dead') report.deadBoards++;
        else addCandidate(db, c, verdict === 'unsupported' ? 'unsupported' : 'active', report);
      });
    });
  }

  // Resolve companies we know by name but have no board for.
  const wanted = opts.names?.map((n) => companyKey(n));
  const unresolved = listCompanies(db, ['unresolved'])
    .filter((c) => !wanted || wanted.includes(companyKey(c.name)))
    .slice(0, opts.resolveLimit ?? 150);
  if (unresolved.length) say(`Looking for boards for ${unresolved.length} companies by name and careers page…`);
  const robots = new RobotsCache(http);
  let resolvedCount = 0;
  const outcomes = await mapPool(unresolved, Math.min(opts.concurrency ?? 8, 4), async (c) => {
    const outcome = await resolveCompany(http, robots, c);
    if (++resolvedCount % 10 === 0) say(`  resolved ${resolvedCount}/${unresolved.length}`);
    return outcome;
  });
  tx(db, () => {
    unresolved.forEach((c, i) => applyOutcome(db, c, outcomes[i] as Awaited<ReturnType<typeof resolveCompany>>, report));
  });

  finishRun(db, runId, { ...report, resolved: report.resolved.length, stillUnresolved: report.stillUnresolved.length });
  return report;
}

function addCandidate(db: DB, c: BoardCandidate, status: 'active' | 'unsupported', report: DiscoverReport): void {
  // Upgrade a company we already knew by name but had no board for.
  const key = companyKey(c.name);
  const known = listCompanies(db, ['unresolved']).find((u) => companyKey(u.name) === key);
  if (known) {
    updateCompany(db, known.id, { ats: c.ats, atsToken: c.token, status, source: c.source, careersUrl: known.careersUrl ?? c.careersUrl });
    report.upgraded++;
  } else {
    insertCompany(db, { name: c.name, ats: c.ats, atsToken: c.token, careersUrl: c.careersUrl, status, source: c.source }, nowIso());
    report.added++;
  }
  if (status === 'unsupported') report.unsupportedRecorded++;
}

function applyOutcome(db: DB, c: Company, o: Awaited<ReturnType<typeof resolveCompany>>, report: DiscoverReport): void {
  if (o.status === 'unresolved') {
    report.stillUnresolved.push(c.name);
    return;
  }
  // Another row may already own this board (e.g. harvested under a different name).
  const owner = o.ats && o.token ? findCompanyByBoard(db, o.ats, o.token) : null;
  if (owner && owner.id !== c.id) {
    updateCompany(db, c.id, { status: 'disabled', lastError: `duplicate of ${owner.name}` });
    return;
  }
  updateCompany(db, c.id, {
    ats: o.ats ?? null,
    atsToken: o.token ?? null,
    status: o.status,
    careersUrl: c.careersUrl ?? o.careersUrl ?? null,
    source: c.source ?? 'resolved',
    lastError: o.status === 'needs_review' ? o.note : null,
  });
  if (o.status === 'active') report.resolved.push({ name: c.name, ats: o.ats as Ats, token: o.token as string, note: o.note });
  else if (o.status === 'needs_review') report.needsReview.push({ name: c.name, note: o.note });
  else report.unsupported.push({ name: c.name, ats: o.ats ?? 'unknown' });
}
