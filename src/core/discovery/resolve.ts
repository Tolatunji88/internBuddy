import { ADAPTERS, isSupportedAts, SUPPORTED_ATS } from '../ats/index.js';
import type { HttpClient } from '../ats/client.js';
import { norm, termRegex, uniq } from '../text.js';
import type { Ats } from '../types.js';
import { detectBoards } from './detect.js';
import type { RobotsCache } from './robots.js';

const NAME_SUFFIXES = new Set([
  'inc', 'incorporated', 'ltd', 'limited', 'llc', 'corp', 'corporation', 'co', 'company', 'technologies',
  'technology', 'tech', 'labs', 'lab', 'group', 'holdings', 'canada', 'the',
]);

/** Plausible board tokens for a company: "MDA Space" + mda.space → mdaspace, mda-space, mda. */
export function candidateSlugs(name: string, domain?: string | null): string[] {
  const words = norm(name)
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const core = words.filter((w) => !NAME_SUFFIXES.has(w));
  const domainRoot = domain ? norm(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[./]/)[0] : undefined;
  return uniq(
    [
      core.join(''),
      core.join('-'),
      words.join(''),
      domainRoot,
      core.length > 1 && (core[0]?.length ?? 0) >= 4 ? core[0] : undefined,
    ].filter((s): s is string => !!s && s.length >= 2),
  ).slice(0, 5);
}

/** Does anything on this board prove it belongs to the company? */
export function boardMentionsCompany(raw: unknown, name: string, domain?: string | null): boolean {
  const hay = norm(JSON.stringify(raw).slice(0, 750_000));
  if (domain) {
    const d = norm(domain).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (d && hay.includes(d)) return true;
  }
  const n = name.trim();
  return n.length >= 3 && termRegex(n).test(hay);
}

export type ResolveStatus = 'active' | 'needs_review' | 'unsupported' | 'unresolved';

export interface ResolveOutcome {
  status: ResolveStatus;
  ats?: string;
  token?: string;
  careersUrl?: string | null;
  note: string;
}

export interface ResolveInput {
  name: string;
  domain?: string | null;
  careersUrl?: string | null;
}

/**
 * Turn a bare company name into a confirmed board. Nothing is marked active without evidence:
 * either the company's own careers page links the board, or the board's postings name the
 * company. A board that exists under a guessed slug but shows no such evidence comes back as
 * `needs_review`, because a common word ("ada", "ramp") can belong to a different company.
 */
export async function resolveCompany(http: HttpClient, robots: RobotsCache, c: ResolveInput): Promise<ResolveOutcome> {
  let weak: { ats: Ats; token: string; count: number } | null = null;

  for (const slug of candidateSlugs(c.name, c.domain)) {
    for (const ats of SUPPORTED_ATS) {
      const adapter = ADAPTERS[ats];
      const res = await http.get(adapter.boardApiUrl(slug));
      if (!res.ok || !adapter.looksLikeBoard(res.body)) continue;
      let count = 0;
      try {
        count = adapter.parse(res.body, c.name).length;
      } catch {
        continue;
      }
      // An empty board proves nothing either way, and some ATSes answer unknown slugs with one.
      if (count === 0) continue;
      if (boardMentionsCompany(res.body, c.name, c.domain)) {
        return { status: 'active', ats, token: slug, note: `${ats} board "${slug}" (${count} postings mention ${c.name})` };
      }
      weak ??= { ats, token: slug, count };
    }
  }

  const fromPage = await careersPageBoards(http, robots, c);
  const supported = fromPage.find((r) => isSupportedAts(r.ats));
  if (supported) {
    const adapter = ADAPTERS[supported.ats as Ats];
    const res = await http.get(adapter.probeUrl(supported.token));
    if (res.ok && adapter.looksLikeBoard(res.body)) {
      return { status: 'active', ats: supported.ats, token: supported.token, note: `linked from ${c.name}'s careers page` };
    }
  }
  const unsupported = fromPage.find((r) => !isSupportedAts(r.ats));
  if (unsupported) {
    return {
      status: 'unsupported',
      ats: unsupported.ats,
      token: unsupported.token,
      careersUrl: unsupported.careersUrl,
      note: `uses ${unsupported.ats}, which internBuddy can't fetch yet`,
    };
  }
  if (weak) {
    return {
      status: 'needs_review',
      ats: weak.ats,
      token: weak.token,
      note: `a ${weak.ats} board "${weak.token}" exists (${weak.count} postings) but nothing on it names ${c.name}. Check ${ADAPTERS[weak.ats].boardPublicUrl(weak.token)} and run \`internbuddy confirm\` if it's theirs`,
    };
  }
  return { status: 'unresolved', note: 'no board found by name or on a careers page' };
}

async function careersPageBoards(http: HttpClient, robots: RobotsCache, c: ResolveInput) {
  const domain = c.domain?.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const pages = uniq(
    [c.careersUrl, domain && `https://${domain}/careers`, domain && `https://www.${domain}/careers`, domain && `https://${domain}/jobs`].filter(
      (u): u is string => !!u,
    ),
  );
  for (const page of pages) {
    try {
      if (!(await robots.allows(page))) continue;
    } catch {
      continue;
    }
    const res = await http.get(page, { as: 'text' });
    if (!res.ok) continue;
    const refs = detectBoards(String(res.body));
    if (refs.length) return refs;
  }
  return [];
}
