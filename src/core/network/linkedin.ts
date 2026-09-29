/**
 * Builds LinkedIn search URLs for a person to click. This module makes NO network requests,
 * and nothing in internBuddy ever may: LinkedIn prohibits automated access, and scraping would
 * mean storing data on people who never agreed to it. We only construct links.
 */
import type { Profile } from '../types.js';
import { targetsFor } from './titles.js';

export type LinkKind = 'alumni' | 'school' | 'club' | 'employer' | 'hometown' | 'role';

export interface ConnectionLink {
  kind: LinkKind;
  label: string;
  url: string;
  /** Why this search is worth running. */
  why?: string;
}

export function peopleSearchUrl(keywords: string): string {
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}`;
}

export function alumniPageUrl(schoolSlug: string, company: string): string {
  return `https://www.linkedin.com/school/${encodeURIComponent(schoolSlug)}/people/?keywords=${encodeURIComponent(company)}`;
}

const quoted = (s: string) => `"${s.replace(/"/g, '')}"`;

/**
 * Affinity links first (shared school, club, employer — the warmest introductions), then
 * role-based searches for who is worth reaching.
 */
export function connectionLinks(job: { company: string; title: string }, profile: Profile): ConnectionLink[] {
  const c = job.company;
  const links: ConnectionLink[] = [];

  for (const s of profile.schools) {
    if (s.linkedinSlug) {
      links.push({
        kind: 'alumni',
        label: `${s.name} alumni at ${c}`,
        url: alumniPageUrl(s.linkedinSlug, c),
        why: 'Alumni page filtered to this company: the warmest cold message there is.',
      });
    } else {
      links.push({ kind: 'school', label: `${s.name} people at ${c}`, url: peopleSearchUrl(`${quoted(c)} ${quoted(s.name)}`) });
    }
  }
  for (const club of profile.clubs) {
    links.push({ kind: 'club', label: `${club} people at ${c}`, url: peopleSearchUrl(`${quoted(c)} ${quoted(club)}`) });
  }
  for (const e of profile.pastEmployers) {
    if (e.toLowerCase() === c.toLowerCase()) continue;
    links.push({ kind: 'employer', label: `Ex-${e} people now at ${c}`, url: peopleSearchUrl(`${quoted(c)} ${quoted(e)}`) });
  }
  for (const t of targetsFor(job.title)) {
    links.push({ kind: 'role', label: `${t.title}s at ${c}`, url: peopleSearchUrl(`${quoted(c)} ${quoted(t.title)}`), why: t.why });
  }
  if (profile.hometown) {
    links.push({
      kind: 'hometown',
      label: `People at ${c} from ${profile.hometown}`,
      url: peopleSearchUrl(`${quoted(c)} ${quoted(profile.hometown)}`),
    });
  }
  return links;
}

/** The two or three links worth showing inline in a digest. */
export function topLinks(links: ConnectionLink[], n = 3): ConnectionLink[] {
  const affinity = links.filter((l) => l.kind !== 'role' && l.kind !== 'hometown');
  const roles = links.filter((l) => l.kind === 'role');
  return [...affinity, ...roles].slice(0, n);
}
