import { escapeRegex, norm } from '../text.js';

/**
 * Location preferences are plain words in the profile, plus a few shorthands:
 *   gta            — Toronto and the surrounding municipalities
 *   ontario        — anywhere in Ontario (includes the GTA)
 *   remote-canada  — remote roles open to people in Canada
 *   canada         — anywhere in Canada
 *   remote         — remote anywhere, including US-only remote (off unless listed)
 *   any            — no location filter
 * Anything else is matched as a word or phrase, e.g. "waterloo", "vancouver", "new york".
 */
export const DEFAULT_LOCATIONS = ['gta', 'ontario', 'remote-canada'];

// Place names that only mean one thing in a job posting.
const GTA_UNIQUE = [
  'toronto', 'greater toronto', 'gta', 'mississauga', 'brampton', 'markham', 'vaughan', 'richmond hill',
  'oakville', 'pickering', 'ajax', 'whitby', 'oshawa', 'north york', 'etobicoke', 'caledon', 'halton hills',
];
// Place names shared with US/UK towns ("Burlington, MA", "Aurora, CO", "Milton Keynes"). These
// count only when the location also says Ontario, ON or Canada.
const GTA_AMBIGUOUS = ['burlington', 'aurora', 'concord', 'milton', 'woodbridge', 'georgetown', 'newmarket', 'scarborough', 'thornhill'];
const ONTARIO_UNIQUE = ['ontario', 'waterloo', 'kitchener', 'guelph', 'ottawa', 'kanata', 'barrie', 'st. catharines', 'mississauga'];
const ONTARIO_AMBIGUOUS = ['cambridge', 'hamilton', 'kingston', 'london', 'windsor', 'niagara', 'sudbury'];

const PROVINCES = 'on|bc|qc|ab|mb|sk|ns|nb|nl|pe|nt|yt|nu';
// "La Cañada Flintridge, CA" is in California.
const CANADA_MARK = new RegExp(`(?<!la )\\bcanada\\b|,\\s*(?:${PROVINCES})\\b|,\\s*can\\b|\\bontario\\b`);
const ONTARIO_MARK = /\bontario\b|,\s*on\b/;
const US_STATES =
  'al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc';
const FOREIGN_MARK = new RegExp(
  `,\\s*(?:${US_STATES})\\b|\\b(?:usa|u\\.s\\.a?|united states|uk|united kingdom|england|scotland|wales|ireland|india|germany|france|australia|singapore|japan|china|mexico|brazil|netherlands|poland|israel|spain|italy|sweden|switzerland)\\b`,
);
const REMOTE = /\b(remote|anywhere|distributed|work from home|wfh)\b/;
const NORTH_AMERICA = /\bnorth america\b|\bamericas\b/;

function anyWord(words: string[]): RegExp {
  return new RegExp(`(?<![a-z])(?:${words.map(escapeRegex).join('|')})(?![a-z])`);
}
const GTA_UNIQUE_RE = anyWord(GTA_UNIQUE);
const GTA_AMBIGUOUS_RE = anyWord(GTA_AMBIGUOUS);
const ONTARIO_UNIQUE_RE = anyWord(ONTARIO_UNIQUE);
const ONTARIO_AMBIGUOUS_RE = anyWord(ONTARIO_AMBIGUOUS);

interface Segment {
  text: string;
  canadian: boolean;
  foreign: boolean;
  remote: boolean;
}

/** "Toronto, ON / New York, NY or Remote" → one segment per place, each judged on its own. */
function segments(location: string, remoteFlag: boolean | null): Segment[] {
  return norm(location)
    .split(/\s*(?:\/|;|\||\n|\bor\b)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => {
      const canadian = CANADA_MARK.test(text);
      return { text, canadian, foreign: !canadian && FOREIGN_MARK.test(text), remote: remoteFlag === true || REMOTE.test(text) };
    });
}

function inGta(s: Segment): boolean {
  if (s.foreign) return false;
  return GTA_UNIQUE_RE.test(s.text) || (GTA_AMBIGUOUS_RE.test(s.text) && s.canadian);
}

function inOntario(s: Segment): boolean {
  if (s.foreign) return false;
  if (inGta(s) || ONTARIO_MARK.test(s.text) || ONTARIO_UNIQUE_RE.test(s.text)) return true;
  return ONTARIO_AMBIGUOUS_RE.test(s.text) && s.canadian;
}

/** Returns a human label for the first preference the location satisfies, or null. */
export function matchLocation(location: string, remote: boolean | null, prefs: string[]): string | null {
  const segs = segments(location, remote);
  if (!segs.length && remote) segs.push({ text: '', canadian: false, foreign: false, remote: true });
  for (const raw of prefs.length ? prefs : DEFAULT_LOCATIONS) {
    const pref = norm(raw.trim());
    if (!pref) continue;
    const hit = (test: (s: Segment) => boolean) => segs.some(test);
    switch (pref) {
      case 'gta':
        if (hit(inGta)) return 'GTA';
        break;
      case 'ontario':
        if (hit(inOntario)) return 'Ontario';
        break;
      case 'remote-canada':
        if (hit((s) => s.remote && (s.canadian || NORTH_AMERICA.test(s.text)))) return 'Remote (Canada)';
        break;
      case 'canada':
        if (hit((s) => s.canadian || inOntario(s))) return 'Canada';
        break;
      case 'remote':
        if (hit((s) => s.remote)) return 'Remote';
        break;
      case 'any':
        return 'Any location';
      default: {
        const re = new RegExp(`(?<![a-z])${escapeRegex(pref)}(?![a-z])`);
        if (hit((s) => re.test(s.text))) return raw.trim();
      }
    }
  }
  return null;
}
