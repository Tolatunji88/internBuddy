import { daysSince, quoteList } from '../format.js';
import { companyKey, norm, termRegex, uniq } from '../text.js';
import type { Profile, StoredJob } from '../types.js';
import { matchLocation } from './location.js';

export interface RankedJob {
  job: StoredJob;
  score: number;
  /** Human-readable, in order of importance. Every point of score is explained here. */
  reasons: string[];
  /** Profile terms found in the posting. */
  matched: string[];
  locationLabel: string | null;
}

/**
 * Anything that can order postings for a person. The deterministic ranker below is the default
 * and works with no AI at all; an LLM-backed ranker can implement the same interface later
 * without touching any caller.
 */
export interface Ranker {
  readonly name: string;
  rank(jobs: StoredJob[], profile: Profile, now?: Date): RankedJob[];
}

const TITLE_WEIGHT = 3;
const DESCRIPTION_WEIGHT = 1;
const ROLE_TYPE_WEIGHT = 2;
/** Long descriptions mention everything; cap how many description terms can add up. */
const MAX_DESCRIPTION_TERMS = 8;

interface Term {
  term: string;
  re: RegExp;
}

function terms(words: string[]): Term[] {
  return uniq(words.map((w) => w.trim()).filter(Boolean)).map((term) => ({ term, re: termRegex(term) }));
}

export class DeterministicRanker implements Ranker {
  readonly name = 'deterministic';

  rank(jobs: StoredJob[], profile: Profile, now: Date = new Date()): RankedJob[] {
    const wanted = terms([...profile.keywords, ...profile.skills]);
    const roles = terms(profile.roleTypes);
    const schools = terms(profile.schools.map((s) => s.name));
    const clubs = terms(profile.clubs);
    const docs = jobs.map((j) => ({ title: norm(j.title), text: norm(`${j.title}\n${j.description}`) }));

    // Inverse document frequency over this batch: a term every posting mentions ("python")
    // says less about fit than one only a few mention ("ros").
    const idf = new Map<string, number>();
    for (const t of wanted) {
      const df = docs.filter((d) => t.re.test(d.text)).length;
      idf.set(t.term, 1 + Math.log((jobs.length + 1) / (df + 1)));
    }
    const weight = (t: Term) => idf.get(t.term) ?? 1;
    const firstLocation = profile.locations[0];

    const ranked = jobs.map((job, i): RankedJob => {
      const doc = docs[i] as { title: string; text: string };
      let score = 0;
      const reasons: string[] = [];

      const inTitle = wanted.filter((t) => t.re.test(doc.title));
      const inDescription = wanted
        .filter((t) => !inTitle.includes(t) && t.re.test(doc.text))
        .sort((a, b) => weight(b) - weight(a))
        .slice(0, MAX_DESCRIPTION_TERMS);
      for (const t of inTitle) score += TITLE_WEIGHT * weight(t);
      for (const t of inDescription) score += DESCRIPTION_WEIGHT * weight(t);
      if (inTitle.length) reasons.push(`title mentions ${quoteList(inTitle.map((t) => t.term))}`);
      if (inDescription.length) reasons.push(`description mentions ${quoteList(inDescription.map((t) => t.term))}`);

      const roleHits = roles.filter((r) => r.re.test(doc.title));
      score += ROLE_TYPE_WEIGHT * roleHits.length;
      if (roleHits.length) reasons.push(`${quoteList(roleHits.map((r) => r.term))} role`);

      const locationLabel = matchLocation(job.location, job.remote, profile.locations);
      if (locationLabel && firstLocation && matchLocation(job.location, job.remote, [firstLocation])) {
        score += 1;
        reasons.push(`in ${locationLabel}`);
      }

      const age = daysSince(job.postedAt, now);
      if (age !== null) {
        if (age <= 3) {
          score += 2;
          reasons.push(age === 0 ? 'posted today' : `posted ${age} day${age === 1 ? '' : 's'} ago`);
        } else if (age <= 10) {
          score += 1;
          reasons.push(`posted ${age} days ago`);
        } else if (age > 60) {
          score -= 1;
          reasons.push('posted over 2 months ago');
        }
      }

      if (profile.gradYear && new RegExp(`\\b${profile.gradYear}\\b`).test(doc.text)) {
        score += 1;
        reasons.push(`mentions ${profile.gradYear}`);
      }

      const companyK = companyKey(job.company);
      const employer = profile.pastEmployers.find((e) => {
        const k = companyKey(e);
        return k.length > 1 && (k === companyK || companyK.includes(k) || k.includes(companyK));
      });
      if (employer) {
        score += 2;
        reasons.push(`you've worked at ${employer}`);
      }
      for (const s of schools) {
        if (s.re.test(doc.text)) {
          score += 1.5;
          reasons.push(`mentions ${s.term}`);
        }
      }
      for (const c of clubs) {
        if (c.re.test(doc.text)) {
          score += 1;
          reasons.push(`mentions ${c.term}`);
        }
      }

      return {
        job,
        score: Math.round(score * 10) / 10,
        reasons,
        matched: [...inTitle, ...inDescription].map((t) => t.term),
        locationLabel,
      };
    });

    return ranked.sort(
      (a, b) =>
        b.score - a.score ||
        (Date.parse(b.job.postedAt ?? b.job.firstSeenAt) || 0) - (Date.parse(a.job.postedAt ?? a.job.firstSeenAt) || 0) ||
        b.job.id - a.job.id,
    );
  }
}
