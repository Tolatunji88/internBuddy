import { htmlToText } from '../text.js';
import type { NormalizedJob } from '../types.js';
import type { AtsAdapter } from './types.js';
import { isObj, isoOrNull, joinLocations, ParseError, str } from './util.js';

// GET https://api.lever.co/v0/postings/{token}?mode=json
// → [{ id, text (title), hostedUrl, createdAt (epoch ms), workplaceType,
//      categories: { commitment, department, team, location, allLocations[] },
//      descriptionPlain, description, lists: [{ text, content }], additionalPlain, additional }]
export const lever: AtsAdapter = {
  ats: 'lever',
  boardApiUrl: (token) => `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`,
  probeUrl: (token) => `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json&limit=1`,
  boardPublicUrl: (token) => `https://jobs.lever.co/${encodeURIComponent(token)}`,
  looksLikeBoard: (raw) => Array.isArray(raw),

  parse(raw, company) {
    if (!Array.isArray(raw)) throw new ParseError('lever: expected an array of postings');
    const out: NormalizedJob[] = [];
    for (const p of raw) {
      if (!isObj(p)) continue;
      const id = str(p.id);
      const title = str(p.text).trim();
      if (!id || !title) continue;

      const cats = isObj(p.categories) ? p.categories : {};
      const locations = [str(cats.location)];
      if (Array.isArray(cats.allLocations)) locations.push(...cats.allLocations.map(str));
      const location = joinLocations(locations);

      const sections = [str(p.descriptionPlain) || htmlToText(str(p.description))];
      if (Array.isArray(p.lists)) {
        for (const l of p.lists) {
          if (isObj(l)) sections.push(`${str(l.text)}\n${htmlToText(str(l.content))}`.trim());
        }
      }
      sections.push(str(p.additionalPlain) || htmlToText(str(p.additional)));

      const workplace = str(p.workplaceType).toLowerCase();
      out.push({
        atsJobId: id,
        company,
        title,
        location,
        url: str(p.hostedUrl),
        description: sections.filter(Boolean).join('\n\n'),
        postedAt: isoOrNull(p.createdAt),
        departments: [str(cats.department), str(cats.team)].filter(Boolean),
        employmentType: str(cats.commitment) || null,
        remote: workplace === 'remote' || /\bremote\b/i.test(location) ? true : null,
      });
    }
    return out;
  },
};
