#!/usr/bin/env node
import './core/quiet.js';
import fs from 'node:fs';
import path from 'node:path';
import { ADAPTERS, isSupportedAts } from './core/ats/index.js';
import { errorMessage } from './core/ats/client.js';
import { type Ctx, openContext } from './core/context.js';
import { discover } from './core/discovery/discover.js';
import { dateStamp } from './core/format.js';
import { kindsFor, selectAndRank } from './core/match/select.js';
import { connectionLinks } from './core/network/linkedin.js';
import { initProfile, isProfileEmpty } from './core/profile.js';
import { exportRegistry, writeRegistry } from './core/registry.js';
import { renderDigest } from './core/report.js';
import { scout } from './core/scout.js';
import {
  companyStatusCounts,
  findCompanyByBoard,
  getJob,
  insertCompany,
  listCompanies,
  queryJobs,
  setTrackState,
  updateCompany,
} from './core/store.js';
import { companyKey } from './core/text.js';
import { type Company, TRACK_STATES, type TrackState } from './core/types.js';
import { connectionsView, jobDetail, jobRow, pageFooter, paginate } from './core/views.js';

const HELP = `internbuddy — find internships, co-ops and student roles, and people worth talking to

Setup
  init                         Create your profile and print where it lives
  where                        Show where your profile, database and reports are

Daily use
  scout [--limit N] [--company NAME]...
                               Check every tracked job board, store new student roles,
                               and write today's digest
  list [--all] [--query Q] [--company C] [--any-location] [--limit N] [--cursor C]
                               Ranked postings (unseen only, unless --all)
  show ID                      Full posting, why it matched, and people to talk to
  track ID STATE [--notes TEXT]
                               STATE: ${TRACK_STATES.join(', ')}
  tracked [STATE]              What you've saved and applied to

Companies
  discover [--scope canada|all] [--name NAME]... [--no-bootstrap]
                               Grow the list of tracked companies
  companies [--status STATUS]  List tracked companies
  add NAME [--domain D] [--careers-url URL] [--ats ATS --token TOKEN]
                               Track a company
  confirm NAME                 Accept a board that needs review
  enable NAME                  Re-enable a disabled board
  export-registry [--out FILE] Write discovered companies back to data/companies.csv to share

MCP (for Claude Code and other agents): run  internbuddy-mcp
`;

interface Args {
  _: string[];
  flags: Map<string, string[]>;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [], flags: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const [key, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
      const next = argv[i + 1];
      const value = inline ?? (next !== undefined && !next.startsWith('--') ? (i++, next) : 'true');
      args.flags.set(key, [...(args.flags.get(key) ?? []), value]);
    } else args._.push(a);
  }
  return args;
}

const flag = (a: Args, k: string) => a.flags.get(k)?.at(-1);
const flags = (a: Args, k: string) => a.flags.get(k) ?? [];
const has = (a: Args, k: string) => a.flags.has(k) && flag(a, k) !== 'false';
const num = (a: Args, k: string) => {
  const v = flag(a, k);
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1) throw new UsageError(`--${k} needs a positive number`);
  return n;
};

class UsageError extends Error {}

// `internbuddy companies | head` closes the pipe early; that's normal, not an error.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const out = (s = ''): void => {
  process.stdout.write(`${s}\n`);
};
const isTty = process.stdout.isTTY === true;

function findCompany(ctx: Ctx, name: string): Company {
  const key = companyKey(name);
  const matches = listCompanies(ctx.db).filter((c) => companyKey(c.name) === key);
  if (!matches.length) throw new UsageError(`No company named "${name}". See \`internbuddy companies\`.`);
  if (matches.length > 1) {
    const withBoard = matches.filter((c) => c.status !== 'disabled');
    if (withBoard.length === 1) return withBoard[0] as Company;
    throw new UsageError(`"${name}" matches ${matches.length} entries: ${matches.map((c) => `${c.name} (${c.ats ?? 'no board'}:${c.atsToken ?? '-'}, ${c.status})`).join('; ')}`);
  }
  return matches[0] as Company;
}

function progressLine(msg: string): void {
  if (isTty) process.stdout.write(`\r\x1b[2K${msg}`);
}
function endProgress(): void {
  if (isTty) process.stdout.write('\r\x1b[2K');
}

function warnIfNoProfile(ctx: Ctx): void {
  const { exists, profile, path: p } = ctx.profile();
  if (!exists) out(`(No profile yet — using defaults. Run \`internbuddy init\` and edit ${p}.)\n`);
  else if (isProfileEmpty(profile)) out(`(Your profile has no keywords, skills or role types yet — edit ${p} for better ranking.)\n`);
}

async function cmdScout(ctx: Ctx, a: Args): Promise<void> {
  warnIfNoProfile(ctx);
  const names = flags(a, 'company');
  const companyIds = names.length ? names.map((n) => findCompany(ctx, n).id) : undefined;
  const t0 = Date.now();
  const report = await scout(ctx, {
    limit: num(a, 'limit'),
    companyIds,
    onProgress: (p) => progressLine(`Checking boards… ${p.done}/${p.total}  ${p.company}`),
  });
  endProgress();

  const { profile } = ctx.profile();
  const fresh = report.newJobIds.length
    ? queryJobs(ctx.db, { kinds: kindsFor(profile), includeSeen: true, ids: report.newJobIds })
    : [];
  const ranked = selectAndRank(fresh, profile, ctx.ranker);

  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  out(`Checked ${report.boards} boards in ${secs}s: ${report.ok} updated, ${report.unchanged} unchanged, ${report.failed.length} failed.`);
  out(`${report.postingsSeen} postings scanned → ${report.studentRoles} open student roles${profile.includeNewGrad ? ` and ${report.newGradRoles} new-grad roles` : ''}.`);
  out(`${report.newJobIds.length} new since last run; ${ranked.length} match your profile and locations.`);
  if (report.closed) out(`${report.closed} postings closed.`);
  if (report.disabled.length) out(`Disabled (failing): ${report.disabled.join(', ')}`);

  if (ranked.length) {
    out('');
    for (const r of ranked.slice(0, 10)) out(jobRow(r));
    if (ranked.length > 10) out(`…and ${ranked.length - 10} more in the digest.`);
  }

  fs.mkdirSync(ctx.paths.reports, { recursive: true });
  let file = path.join(ctx.paths.reports, `${dateStamp()}.md`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(ctx.paths.reports, `${dateStamp()}-${n}.md`);
  fs.writeFileSync(file, renderDigest(report, ranked, profile), 'utf8');
  out(`\nDigest: ${file}`);
  if (report.failed.length && !report.ok && !report.unchanged) {
    out('\nEvery board failed. If you are offline or behind a restrictive network, that is the likely cause.');
    process.exitCode = 1;
  }
}

async function cmdDiscover(ctx: Ctx, a: Args): Promise<void> {
  const scope = flag(a, 'scope');
  if (scope && scope !== 'canada' && scope !== 'all') throw new UsageError('--scope is canada or all');
  const r = await discover(ctx, {
    scope: scope as 'canada' | 'all' | undefined,
    names: flags(a, 'name'),
    bootstrap: !has(a, 'no-bootstrap'),
    resolveLimit: num(a, 'limit'),
    onProgress: (m) => (isTty ? progressLine(m) : out(m)),
  });
  endProgress();
  if (r.sourcesOk.length || r.sourceErrors.length) {
    out(`SimplifyJobs: ${r.candidates} boards in scope · ${r.alreadyKnown} already known · ${r.added} added · ${r.upgraded} matched to known companies · ${r.deadBoards} gone`);
    for (const e of r.sourceErrors) out(`  source ${e.id} failed: ${e.error}`);
  }
  if (r.resolved.length) out(`Found boards for ${r.resolved.length}: ${r.resolved.map((x) => `${x.name} (${x.ats})`).join(', ')}`);
  if (r.unsupported.length) out(`On systems we can't fetch yet: ${r.unsupported.map((x) => `${x.name} (${x.ats})`).join(', ')}`);
  if (r.needsReview.length) {
    out(`\nNeed your review (${r.needsReview.length}):`);
    for (const n of r.needsReview) out(`  ${n.name}: ${n.note}`);
  }
  if (r.stillUnresolved.length) out(`\nNo board found for ${r.stillUnresolved.length}: ${r.stillUnresolved.join(', ')}`);
  const c = companyStatusCounts(ctx.db);
  out(`\nRegistry: ${c.active ?? 0} active · ${c.unsupported ?? 0} unsupported · ${c.unresolved ?? 0} unresolved · ${c.needs_review ?? 0} need review · ${c.disabled ?? 0} disabled`);
}

function cmdList(ctx: Ctx, a: Args): void {
  const { profile } = ctx.profile();
  const jobs = queryJobs(ctx.db, { kinds: kindsFor(profile), includeSeen: has(a, 'all') });
  const ranked = selectAndRank(jobs, profile, ctx.ranker, {
    query: flag(a, 'query'),
    company: flag(a, 'company'),
    anyLocation: has(a, 'any-location'),
  });
  const page = paginate(ranked, flag(a, 'cursor'), num(a, 'limit') ?? 20);
  if (!page.total) {
    out(has(a, 'all') ? 'No stored postings match.' : 'Nothing unseen matches your profile. Try --all, or run `internbuddy scout`.');
    return;
  }
  for (const r of page.items) out(jobRow(r));
  out(`\n${pageFooter(page).replace('More: cursor=', 'Next page: --cursor ')}`);
}

function cmdShow(ctx: Ctx, a: Args): void {
  const id = Number.parseInt(a._[1] ?? '', 10);
  const job = Number.isFinite(id) ? getJob(ctx.db, id) : null;
  if (!job) throw new UsageError('Usage: internbuddy show ID  (the number after # in lists)');
  const { profile } = ctx.profile();
  const pool = queryJobs(ctx.db, { kinds: ['internship', 'new_grad'], includeSeen: true });
  if (!pool.some((j) => j.id === job.id)) pool.push(job);
  const ranked = ctx.ranker.rank(pool, profile).find((r) => r.job.id === job.id) ?? null;
  out(jobDetail(job, ranked, new Date(), 2500));
  out('');
  const hasAffinities = profile.schools.length + profile.clubs.length + profile.pastEmployers.length > 0;
  out(connectionsView(job, connectionLinks(job, profile), hasAffinities));
}

function cmdTrack(ctx: Ctx, a: Args): void {
  const id = Number.parseInt(a._[1] ?? '', 10);
  const state = a._[2] as TrackState | undefined;
  if (!Number.isFinite(id) || !state || !TRACK_STATES.includes(state)) {
    throw new UsageError(`Usage: internbuddy track ID STATE   (STATE: ${TRACK_STATES.join(', ')})`);
  }
  const job = getJob(ctx.db, id);
  if (!job) throw new UsageError(`No posting #${id}.`);
  setTrackState(ctx.db, id, state, flag(a, 'notes') ?? null);
  out(`#${id} ${job.title} — ${job.company}: ${state}`);
}

function cmdTracked(ctx: Ctx, a: Args): void {
  const state = a._[1] as TrackState | undefined;
  if (state && !TRACK_STATES.includes(state)) throw new UsageError(`STATE is one of ${TRACK_STATES.join(', ')}`);
  const jobs = queryJobs(ctx.db, { kinds: ['internship', 'new_grad'], includeSeen: true, openOnly: false, tracked: state ?? true });
  if (!jobs.length) return out('Nothing tracked yet. Use `internbuddy track ID saved`.');
  for (const s of TRACK_STATES) {
    const group = jobs.filter((j) => j.state === s);
    if (!group.length) continue;
    out(`${s.toUpperCase()} (${group.length})`);
    for (const j of group) out(`  #${j.id} ${j.title} — ${j.company}${j.isOpen ? '' : ' (closed)'}${j.notes ? ` · ${j.notes}` : ''}`);
  }
}

function cmdCompanies(ctx: Ctx, a: Args): void {
  const status = flag(a, 'status');
  const list = listCompanies(ctx.db, status ? [status as Company['status']] : undefined);
  for (const c of list) {
    const board = c.atsToken ? `${c.ats}:${c.atsToken}` : 'no board';
    const note = c.status === 'disabled' || c.status === 'needs_review' ? `  (${c.lastError ?? ''})` : '';
    out(`${c.status.padEnd(12)} ${c.name.padEnd(36).slice(0, 36)} ${board}${note}`);
  }
  const counts = companyStatusCounts(ctx.db);
  out(`\n${list.length} shown · ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
}

async function cmdAdd(ctx: Ctx, a: Args): Promise<void> {
  const name = a._.slice(1).join(' ').trim();
  if (!name) throw new UsageError('Usage: internbuddy add NAME [--domain example.com] [--ats greenhouse --token example]');
  const ats = flag(a, 'ats');
  const token = flag(a, 'token');
  if (ats || token) {
    if (!ats || !token) throw new UsageError('--ats and --token go together');
    const owner = findCompanyByBoard(ctx.db, ats, token);
    if (owner) return out(`That board is already tracked as ${owner.name} (${owner.status}).`);
    let status: Company['status'] = 'unsupported';
    if (isSupportedAts(ats)) {
      const res = await ctx.http.get(ADAPTERS[ats].probeUrl(token));
      if (!res.ok || !ADAPTERS[ats].looksLikeBoard(res.body)) {
        throw new UsageError(`Couldn't load ${ats} board "${token}": ${res.error ?? 'unexpected response'}. Check the token.`);
      }
      status = 'active';
    }
    insertCompany(ctx.db, { name, ats, atsToken: token, domain: flag(a, 'domain') ?? null, status, source: 'added' });
    return out(`Tracking ${name} (${ats}:${token}, ${status}).`);
  }
  const existing = listCompanies(ctx.db).filter((c) => companyKey(c.name) === companyKey(name));
  if (existing.some((c) => c.status === 'active')) return out(`${name} is already tracked.`);
  if (!existing.length) {
    insertCompany(ctx.db, { name, domain: flag(a, 'domain') ?? null, careersUrl: flag(a, 'careers-url') ?? null, source: 'added' });
  } else {
    for (const c of existing) updateCompany(ctx.db, c.id, { status: 'unresolved', domain: flag(a, 'domain') ?? c.domain });
  }
  out(`Looking for ${name}'s job board…`);
  await cmdDiscover(ctx, { _: [], flags: new Map([['name', [name]], ['no-bootstrap', ['true']]]) });
}

function cmdConfirm(ctx: Ctx, a: Args): void {
  const c = findCompany(ctx, a._.slice(1).join(' '));
  if (!c.atsToken || !isSupportedAts(c.ats)) throw new UsageError(`${c.name} has no board to confirm.`);
  updateCompany(ctx.db, c.id, { status: 'active', lastError: null, failCount: 0 });
  out(`${c.name} (${c.ats}:${c.atsToken}) is now active.`);
}

function cmdEnable(ctx: Ctx, a: Args): void {
  const c = findCompany(ctx, a._.slice(1).join(' '));
  if (!c.atsToken) throw new UsageError(`${c.name} has no board. Try \`internbuddy discover --name "${c.name}"\`.`);
  updateCompany(ctx.db, c.id, { status: isSupportedAts(c.ats) ? 'active' : 'unsupported', lastError: null, failCount: 0 });
  out(`${c.name} re-enabled.`);
}

function cmdExport(ctx: Ctx, a: Args): void {
  const file = path.resolve(flag(a, 'out') ?? ctx.paths.registryCsv);
  const rows = exportRegistry(ctx.db);
  writeRegistry(file, rows);
  out(`Wrote ${rows.length} companies to ${file}`);
}

async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  const cmd = a._[0];
  if (!cmd || cmd === 'help' || has(a, 'help')) return out(HELP);

  const ctx = openContext();
  try {
    switch (cmd) {
      case 'init': {
        const created = initProfile(ctx.paths.profile, ctx.paths.profileExample);
        out(created ? `Created your profile: ${ctx.paths.profile}` : `Your profile already exists: ${ctx.paths.profile}`);
        out('Edit it: keywords, skills, locations, and your schools, clubs and past employers.');
        out('Then run `internbuddy discover` once, and `internbuddy scout` any time.');
        return;
      }
      case 'where':
        out(`profile   ${ctx.paths.profile}${fs.existsSync(ctx.paths.profile) ? '' : '  (not created yet — run `internbuddy init`)'}`);
        out(`database  ${ctx.paths.db}`);
        out(`reports   ${ctx.paths.reports}`);
        out(`registry  ${ctx.paths.registryCsv}`);
        return;
      case 'scout':
        return await cmdScout(ctx, a);
      case 'discover':
        return await cmdDiscover(ctx, a);
      case 'list':
        return cmdList(ctx, a);
      case 'show':
        return cmdShow(ctx, a);
      case 'track':
        return cmdTrack(ctx, a);
      case 'tracked':
        return cmdTracked(ctx, a);
      case 'companies':
        return cmdCompanies(ctx, a);
      case 'add':
        return await cmdAdd(ctx, a);
      case 'confirm':
        return cmdConfirm(ctx, a);
      case 'enable':
        return cmdEnable(ctx, a);
      case 'export-registry':
        return cmdExport(ctx, a);
      default:
        throw new UsageError(`Unknown command "${cmd}".\n\n${HELP}`);
    }
  } finally {
    ctx.close();
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  endProgress();
  process.stderr.write(`${err instanceof UsageError ? err.message : `Error: ${errorMessage(err)}`}\n`);
  process.exitCode = err instanceof UsageError ? 2 : 1;
});
