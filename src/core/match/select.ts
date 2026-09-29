import { daysSince } from '../format.js';
import { norm, termRegex } from '../text.js';
import type { JobKind, Profile, StoredJob } from '../types.js';
import { matchLocation } from './location.js';
import type { RankedJob, Ranker } from './rank.js';

export interface SelectOptions {
  /** Free text; every word (or "quoted phrase") must appear in the posting. */
  query?: string;
  company?: string;
  postedWithinDays?: number;
  /** Show postings outside the profile's locations too. */
  anyLocation?: boolean;
}

export function kindsFor(profile: Profile): JobKind[] {
  return profile.includeNewGrad ? ['internship', 'new_grad'] : ['internship'];
}

function queryTerms(query: string): RegExp[] {
  const parts = query.match(/"[^"]+"|\S+/g) ?? [];
  return parts.map((p) => p.replace(/^"|"$/g, '')).filter(Boolean).map(termRegex);
}

/** Apply the profile's hard filters, then rank what's left. */
export function selectAndRank(
  jobs: StoredJob[],
  profile: Profile,
  ranker: Ranker,
  opts: SelectOptions = {},
  now: Date = new Date(),
): RankedJob[] {
  const kinds = kindsFor(profile);
  const excluded = profile.excludeKeywords.map(termRegex);
  const query = opts.query ? queryTerms(opts.query) : [];
  const company = opts.company ? norm(opts.company) : null;

  const kept = jobs.filter((j) => {
    if (!kinds.includes(j.kind)) return false;
    const title = norm(j.title);
    if (excluded.some((re) => re.test(title))) return false;
    if (!opts.anyLocation && !matchLocation(j.location, j.remote, profile.locations)) return false;
    if (company && !norm(j.company).includes(company)) return false;
    if (opts.postedWithinDays !== undefined) {
      const age = daysSince(j.postedAt ?? j.firstSeenAt, now);
      if (age === null || age > opts.postedWithinDays) return false;
    }
    if (query.length) {
      const text = norm(`${j.title}\n${j.company}\n${j.location}\n${j.description}`);
      if (!query.every((re) => re.test(text))) return false;
    }
    return true;
  });
  return ranker.rank(kept, profile, now);
}
