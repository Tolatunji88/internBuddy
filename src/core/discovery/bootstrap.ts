import type { HttpClient } from '../ats/client.js';
import { matchLocation } from '../match/location.js';
import { isObj, str } from '../ats/util.js';
import { detectBoards } from './detect.js';

/**
 * SimplifyJobs publishes its curated internship and new-grad lists as structured JSON,
 * including postings that have since closed. Every posting URL names a job board, so this is a
 * large, public, human-curated source of real board tokens — no guessing.
 *
 * The board is the unit, not the posting: a company whose Simplify listing is in New York may
 * still post Toronto co-ops on the same board, and fetching the board returns all of them.
 */
export interface ListingSource {
  id: string;
  /** Tried in order; the first that loads wins (repos get renamed each season). */
  urls: string[];
}

const RAW = 'https://raw.githubusercontent.com/SimplifyJobs';
export const SIMPLIFY_SOURCES: ListingSource[] = [
  {
    id: 'simplify-internships',
    urls: [
      `${RAW}/Summer2027-Internships/dev/.github/scripts/listings.json`,
      `${RAW}/Summer2026-Internships/dev/.github/scripts/listings.json`,
    ],
  },
  { id: 'simplify-new-grad', urls: [`${RAW}/New-Grad-Positions/dev/.github/scripts/listings.json`] },
];

export interface BoardCandidate {
  name: string;
  ats: string;
  token: string;
  careersUrl: string | null;
  /** At least one listing on this board was located in Canada. */
  canada: boolean;
  listings: number;
  source: string;
}

/** Group a listings.json array by board. */
export function extractCandidates(listings: unknown, sourceId: string): BoardCandidate[] {
  if (!Array.isArray(listings)) return [];
  const byBoard = new Map<string, BoardCandidate & { names: Map<string, number> }>();
  for (const l of listings) {
    if (!isObj(l)) continue;
    const url = str(l.url);
    const name = str(l.company_name).trim();
    if (!url || !name) continue;
    const locations = Array.isArray(l.locations) ? l.locations.map(str) : [];
    const inCanada = locations.some((loc) => matchLocation(loc, null, ['canada']) !== null);
    for (const ref of detectBoards(url)) {
      const key = `${ref.ats}:${ref.token.toLowerCase()}`;
      let c = byBoard.get(key);
      if (!c) {
        c = { name, ats: ref.ats, token: ref.token, careersUrl: ref.careersUrl, canada: false, listings: 0, source: sourceId, names: new Map() };
        byBoard.set(key, c);
      }
      c.listings++;
      c.canada ||= inCanada;
      c.names.set(name, (c.names.get(name) ?? 0) + 1);
    }
  }
  return [...byBoard.values()].map(({ names, ...c }) => ({
    ...c,
    // A board's most common company name wins ("Doordash" vs "DoorDash").
    name: [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? c.name,
  }));
}

export function mergeCandidates(lists: BoardCandidate[][]): BoardCandidate[] {
  const merged = new Map<string, BoardCandidate>();
  for (const list of lists) {
    for (const c of list) {
      const key = `${c.ats}:${c.token.toLowerCase()}`;
      const prev = merged.get(key);
      if (!prev) merged.set(key, { ...c });
      else {
        prev.listings += c.listings;
        prev.canada ||= c.canada;
        prev.careersUrl ??= c.careersUrl;
      }
    }
  }
  return [...merged.values()];
}

export interface HarvestResult {
  candidates: BoardCandidate[];
  sourcesOk: string[];
  sourceErrors: { id: string; error: string }[];
}

export async function harvestSimplify(http: HttpClient, sources: ListingSource[] = SIMPLIFY_SOURCES): Promise<HarvestResult> {
  const lists: BoardCandidate[][] = [];
  const sourcesOk: string[] = [];
  const sourceErrors: { id: string; error: string }[] = [];
  for (const source of sources) {
    let lastError = 'no URLs';
    let loaded = false;
    for (const url of source.urls) {
      const res = await http.get(url, { as: 'json' });
      if (res.ok && Array.isArray(res.body)) {
        lists.push(extractCandidates(res.body, source.id));
        sourcesOk.push(source.id);
        loaded = true;
        break;
      }
      lastError = res.ok ? 'unexpected format (expected a JSON array of listings)' : (res.error ?? `HTTP ${res.status}`);
    }
    if (!loaded) sourceErrors.push({ id: source.id, error: lastError });
  }
  return { candidates: mergeCandidates(lists), sourcesOk, sourceErrors };
}
