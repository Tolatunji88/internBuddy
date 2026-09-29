import { htmlToText } from '../text.js';
import type { NormalizedJob } from '../types.js';
import type { AtsAdapter } from './types.js';
import { isObj, isoOrNull, joinLocations, ParseError, str } from './util.js';

// GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true
// → { jobs: [{ id, title, location: { name }, absolute_url, content (entity-escaped HTML),
//              updated_at, first_published, departments: [{ name }], offices: [{ name, location }] }] }
export const greenhouse: AtsAdapter = {
  ats: 'greenhouse',
  boardApiUrl: (token) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
  probeUrl: (token) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`,
  boardPublicUrl: (token) => `https://job-boards.greenhouse.io/${encodeURIComponent(token)}`,
  looksLikeBoard: (raw) => isObj(raw) && Array.isArray(raw.jobs),

  parse(raw, company) {
    if (!isObj(raw) || !Array.isArray(raw.jobs)) throw new ParseError('greenhouse: expected {"jobs": [...]}');
    const out: NormalizedJob[] = [];
    for (const j of raw.jobs) {
      if (!isObj(j)) continue;
      const id = str(j.id);
      const title = str(j.title).trim();
      if (!id || !title) continue;

      const locations: string[] = [];
      if (isObj(j.location)) locations.push(str(j.location.name));
      if (Array.isArray(j.offices)) {
        for (const o of j.offices) if (isObj(o)) locations.push(str(o.location) || str(o.name));
      }
      const location = joinLocations(locations);

      out.push({
        atsJobId: id,
        company,
        title,
        location,
        url: str(j.absolute_url),
        description: htmlToText(str(j.content)),
        postedAt: isoOrNull(j.first_published) ?? isoOrNull(j.updated_at),
        departments: Array.isArray(j.departments)
          ? j.departments.map((d) => (isObj(d) ? str(d.name) : '')).filter(Boolean)
          : [],
        employmentType: null,
        remote: /\bremote\b/i.test(location) ? true : null,
      });
    }
    return out;
  },
};
