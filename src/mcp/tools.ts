import YAML from 'yaml';
import { errorMessage } from '../core/ats/client.js';
import type { Ctx } from '../core/context.js';
import { type DiscoverReport, discover } from '../core/discovery/discover.js';
import { ago } from '../core/format.js';
import { kindsFor, selectAndRank } from '../core/match/select.js';
import { connectionLinks } from '../core/network/linkedin.js';
import { isProfileEmpty, type ProfilePatch, profileToFile, updateProfile } from '../core/profile.js';
import { type ScoutProgress, type ScoutReport, scout } from '../core/scout.js';
import {
  companyStatusCounts,
  getJob,
  insertCompany,
  jobCounts,
  lastRun,
  listCompanies,
  markSeen,
  queryJobs,
  setTrackState,
} from '../core/store.js';
import { companyKey } from '../core/text.js';
import { TRACK_STATES, type TrackState } from '../core/types.js';
import { connectionsView, jobDetail, jobRow, pageFooter, paginate } from '../core/views.js';

export interface ToolResult {
  text: string;
  isError?: boolean;
}

const ok = (text: string): ToolResult => ({ text });
const err = (text: string): ToolResult => ({ text, isError: true });

const sleep = (ms: number) =>
  new Promise<'timeout'>((resolve) => {
    const t = setTimeout(() => resolve('timeout'), ms);
    t.unref?.();
  });

/**
 * A long job the agent can start, poll and read, without the tool call itself blocking on a
 * multi-minute scan. Only one runs at a time; calling again while it runs reports progress.
 */
class BackgroundJob<R> {
  private running: Promise<R> | null = null;
  progress = '';
  last: R | null = null;
  lastError: string | null = null;

  get busy(): boolean {
    return this.running !== null;
  }

  start(run: (setProgress: (p: string) => void) => Promise<R>): Promise<R> {
    if (this.running) return this.running;
    this.progress = 'starting';
    this.lastError = null;
    this.running = run((p) => {
      this.progress = p;
    })
      .then((r) => {
        this.last = r;
        return r;
      })
      .catch((e: unknown) => {
        this.lastError = errorMessage(e);
        throw e;
      })
      .finally(() => {
        this.running = null;
      });
    this.running.catch(() => {});
    return this.running;
  }

  /** Wait up to `seconds`; returns the result, or null if it's still going. */
  async wait(promise: Promise<R>, seconds: number): Promise<R | null> {
    const winner = await Promise.race([promise.catch(() => null), sleep(Math.max(0, seconds) * 1000)]);
    return winner === 'timeout' ? null : (winner as R | null);
  }
}

export function createHandlers(ctx: Ctx) {
  const scan = new BackgroundJob<ScoutReport>();
  const discovery = new BackgroundJob<DiscoverReport>();

  const loadProfile = () => ctx.profile();

  function summarizeScout(r: ScoutReport): string {
    const { profile } = loadProfile();
    const fresh = r.newJobIds.length ? queryJobs(ctx.db, { kinds: kindsFor(profile), includeSeen: true, ids: r.newJobIds }) : [];
    const matching = selectAndRank(fresh, profile, ctx.ranker);
    const lines = [
      `Checked ${r.boards} boards: ${r.ok} updated, ${r.unchanged} unchanged, ${r.failed.length} failed.`,
      `${r.postingsSeen} postings scanned → ${r.studentRoles} open student roles on those boards.`,
      `${r.newJobIds.length} postings are new since the last scan; ${matching.length} match your profile and locations.`,
    ];
    if (r.closed) lines.push(`${r.closed} postings closed (gone from their boards).`);
    if (r.disabled.length) lines.push(`Disabled after failing: ${r.disabled.slice(0, 10).join(', ')}${r.disabled.length > 10 ? '…' : ''}.`);
    if (matching.length) lines.push('Call list_new_postings to see them.');
    return lines.join('\n');
  }

  function summarizeDiscover(r: DiscoverReport): string {
    const lines: string[] = [];
    if (r.sourcesOk.length || r.sourceErrors.length) {
      lines.push(
        `SimplifyJobs: ${r.candidates} boards in scope, ${r.alreadyKnown} already known, ${r.added} added, ${r.upgraded} matched to known companies, ${r.deadBoards} no longer exist.`,
      );
      for (const e of r.sourceErrors) lines.push(`Source ${e.id} failed: ${e.error}`);
    }
    if (r.resolved.length) lines.push(`Found boards for: ${r.resolved.map((x) => `${x.name} (${x.ats})`).join(', ')}.`);
    if (r.unsupported.length) {
      lines.push(`Recorded for a future adapter: ${r.unsupported.map((x) => `${x.name} (${x.ats})`).join(', ')}.`);
    }
    for (const n of r.needsReview) lines.push(`Needs your review — ${n.name}: ${n.note}`);
    if (r.stillUnresolved.length) lines.push(`No board found for: ${r.stillUnresolved.slice(0, 20).join(', ')}${r.stillUnresolved.length > 20 ? '…' : ''}.`);
    const counts = companyStatusCounts(ctx.db);
    lines.push(`Registry now: ${counts.active ?? 0} active boards, ${counts.unsupported ?? 0} on unsupported systems, ${counts.unresolved ?? 0} unresolved.`);
    return lines.join('\n');
  }

  return {
    async getOverview(): Promise<ToolResult> {
      const { profile, exists, path } = loadProfile();
      const counts = companyStatusCounts(ctx.db);
      const jobs = jobCounts(ctx.db);
      const last = lastRun(ctx.db, 'scout');
      const lines = [
        `Profile: ${exists ? path : `none yet (would be created at ${path})`}${exists && isProfileEmpty(profile) ? ' — no keywords, skills or role types set' : ''}`,
        `Looking for: ${profile.includeNewGrad ? 'internships, co-ops, student roles and new-grad roles' : 'internships, co-ops and student roles'} in ${profile.locations.join(', ')}`,
        `Boards: ${counts.active ?? 0} active, ${counts.unresolved ?? 0} unresolved, ${counts.needs_review ?? 0} need review, ${counts.unsupported ?? 0} unsupported, ${counts.disabled ?? 0} disabled`,
        `Postings: ${jobs.internshipsOpen} open student roles stored, ${jobs.unseen} not yet seen, ${jobs.tracked} tracked`,
        `Last scan: ${last?.finishedAt ? ago(last.finishedAt) : 'never — call refresh_boards'}${scan.busy ? ` (a scan is running now: ${scan.progress})` : ''}`,
      ];
      if (!exists || isProfileEmpty(profile)) {
        lines.push('', 'Next: help the user fill in their profile with set_profile — ranking and people-to-talk-to links depend on it.');
      }
      return ok(lines.join('\n'));
    },

    async listNewPostings(a: { limit?: number; cursor?: string; mark_seen?: boolean }): Promise<ToolResult> {
      const { profile } = loadProfile();
      const ranked = selectAndRank(queryJobs(ctx.db, { kinds: kindsFor(profile), includeSeen: false }), profile, ctx.ranker);
      const page = paginate(ranked, a.cursor, a.limit ?? 10);
      if (!page.total) {
        return ok(
          `No new postings match your profile. ${scan.busy ? `A scan is running (${scan.progress}); try again shortly.` : 'Call refresh_boards to check the boards, or search_postings with include_seen to look back.'}`,
        );
      }
      if (a.mark_seen !== false) markSeen(ctx.db, page.items.map((r) => r.job.id));
      return ok(`${page.items.map((r) => jobRow(r)).join('\n')}\n\n${pageFooter(page)}\nUse get_posting for the full description, suggest_connections for people to talk to.`);
    },

    async searchPostings(a: {
      query?: string; company?: string; posted_within_days?: number; include_seen?: boolean;
      any_location?: boolean; limit?: number; cursor?: string;
    }): Promise<ToolResult> {
      const { profile } = loadProfile();
      const jobs = queryJobs(ctx.db, { kinds: kindsFor(profile), includeSeen: a.include_seen !== false });
      const ranked = selectAndRank(jobs, profile, ctx.ranker, {
        query: a.query, company: a.company, postedWithinDays: a.posted_within_days, anyLocation: a.any_location,
      });
      const page = paginate(ranked, a.cursor, a.limit ?? 10);
      if (!page.total) return ok('No open student roles match that search.');
      return ok(`${page.items.map((r) => jobRow(r)).join('\n')}\n\n${pageFooter(page)}`);
    },

    async getPosting(a: { id: number }): Promise<ToolResult> {
      const job = getJob(ctx.db, a.id);
      if (!job) return err(`No posting #${a.id}.`);
      const { profile } = loadProfile();
      // Rank against everything open so the score means the same thing it does in lists.
      const pool = queryJobs(ctx.db, { kinds: ['internship', 'new_grad'], includeSeen: true });
      if (!pool.some((j) => j.id === job.id)) pool.push(job);
      const ranked = ctx.ranker.rank(pool, profile).find((r) => r.job.id === job.id) ?? null;
      markSeen(ctx.db, [job.id]);
      return ok(jobDetail(job, ranked));
    },

    async suggestConnections(a: { id: number }): Promise<ToolResult> {
      const job = getJob(ctx.db, a.id);
      if (!job) return err(`No posting #${a.id}.`);
      const { profile } = loadProfile();
      const hasAffinities = profile.schools.length + profile.clubs.length + profile.pastEmployers.length > 0;
      return ok(connectionsView(job, connectionLinks(job, profile), hasAffinities));
    },

    async setStatus(a: { id: number; state: TrackState; notes?: string }): Promise<ToolResult> {
      const job = getJob(ctx.db, a.id);
      if (!job) return err(`No posting #${a.id}.`);
      setTrackState(ctx.db, a.id, a.state, a.notes ?? null);
      return ok(`#${a.id} ${job.title} — ${job.company} marked ${a.state}.`);
    },

    async listTracked(a: { state?: TrackState }): Promise<ToolResult> {
      const jobs = queryJobs(ctx.db, { kinds: ['internship', 'new_grad'], includeSeen: true, openOnly: false, tracked: a.state ?? true });
      if (!jobs.length) return ok(a.state ? `Nothing marked ${a.state}.` : 'Nothing tracked yet. Use set_status to save or mark postings.');
      const lines: string[] = [];
      for (const state of TRACK_STATES) {
        const group = jobs.filter((j) => j.state === state);
        if (!group.length) continue;
        lines.push(`${state.toUpperCase()} (${group.length})`);
        for (const j of group) {
          lines.push(`  #${j.id} ${j.title} — ${j.company}${j.isOpen ? '' : ' (closed)'}${j.notes ? ` · ${j.notes}` : ''}`);
        }
      }
      return ok(lines.join('\n'));
    },

    async getProfile(): Promise<ToolResult> {
      const { profile, exists, path } = loadProfile();
      const header = exists ? `Profile at ${path}:` : `No profile file yet; these are the defaults. set_profile will create ${path}.`;
      return ok(`${header}\n\n${YAML.stringify(profileToFile(profile)).trim()}`);
    },

    async setProfile(patch: ProfilePatch): Promise<ToolResult> {
      try {
        const profile = updateProfile(ctx.paths.profile, patch, ctx.paths.profileExample);
        return ok(`Saved ${ctx.paths.profile}:\n\n${YAML.stringify(profileToFile(profile)).trim()}`);
      } catch (e) {
        return err(errorMessage(e));
      }
    },

    async refreshBoards(a: { limit?: number; companies?: string[]; wait_seconds?: number }): Promise<ToolResult> {
      if (scan.busy) {
        return ok(`A scan is already running (${scan.progress}). Postings stored so far are already searchable; call refresh_boards again later to check.`);
      }
      let companyIds: number[] | undefined;
      if (a.companies?.length) {
        const keys = a.companies.map(companyKey);
        companyIds = listCompanies(ctx.db, ['active']).filter((c) => keys.includes(companyKey(c.name))).map((c) => c.id);
        if (!companyIds.length) return err(`None of ${a.companies.join(', ')} are active boards. Try add_company.`);
      }
      const running = scan.start((set) =>
        scout(ctx, {
          limit: a.limit,
          companyIds,
          onProgress: (p: ScoutProgress) => set(`${p.done}/${p.total} boards checked`),
        }),
      );
      const result = await scan.wait(running, a.wait_seconds ?? 20);
      if (result) return ok(summarizeScout(result));
      if (scan.lastError) return err(`Scan failed: ${scan.lastError}`);
      return ok(
        `Scan started and still running (${scan.progress}). Postings it has stored are already searchable. Call refresh_boards again to check on it; it won't start a second scan.`,
      );
    },

    async lastScanResult(): Promise<ToolResult> {
      if (scan.busy) return ok(`Scan running: ${scan.progress}.`);
      if (scan.last) return ok(summarizeScout(scan.last));
      return ok('No scan has run in this session.');
    },

    async discoverCompanies(a: { scope?: 'canada' | 'all'; names?: string[]; wait_seconds?: number }): Promise<ToolResult> {
      if (discovery.busy) return ok(`Discovery is already running (${discovery.progress}).`);
      const running = discovery.start((set) => discover(ctx, { scope: a.scope, names: a.names, onProgress: set }));
      const result = await discovery.wait(running, a.wait_seconds ?? 30);
      if (result) return ok(summarizeDiscover(result));
      if (discovery.lastError) return err(`Discovery failed: ${discovery.lastError}`);
      return ok(`Discovery is running (${discovery.progress}). Call discover_companies again to check on it.`);
    },

    async addCompany(a: { name: string; domain?: string; careers_url?: string; wait_seconds?: number }): Promise<ToolResult> {
      const key = companyKey(a.name);
      const existing = listCompanies(ctx.db).filter((c) => companyKey(c.name) === key);
      if (existing.some((c) => c.status === 'active')) return ok(`${a.name} is already tracked.`);
      if (!existing.length) {
        insertCompany(ctx.db, { name: a.name, domain: a.domain ?? null, careersUrl: a.careers_url ?? null, source: 'added' });
      }
      const running = discovery.start((set) => discover(ctx, { names: [a.name], bootstrap: false, onProgress: set }));
      const result = await discovery.wait(running, a.wait_seconds ?? 45);
      if (!result) return ok(`Still looking for ${a.name}'s job board. Call discover_companies to check on it.`);
      return ok(summarizeDiscover(result));
    },
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
