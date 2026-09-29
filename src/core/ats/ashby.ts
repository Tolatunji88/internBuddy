import { htmlToText } from '../text.js';
import type { NormalizedJob } from '../types.js';
import type { AtsAdapter } from './types.js';
import { isObj, isoOrNull, joinLocations, ParseError, str } from './util.js';

// GET https://api.ashbyhq.com/posting-api/job-board/{token}
// → { jobs: [{ id, title, location, secondaryLocations: [{ location }], isListed, isRemote,
//              workplaceType, employmentType, department, team, publishedAt, jobUrl,
//              descriptionPlain, descriptionHtml,
//              address: { postalAddress: { addressLocality, addressRegion, addressCountry } } }] }
export const ashby: AtsAdapter = {
  ats: 'ashby',
  boardApiUrl: (token) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
  probeUrl: (token) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`,
  boardPublicUrl: (token) => `https://jobs.ashbyhq.com/${encodeURIComponent(token)}`,
  looksLikeBoard: (raw) => isObj(raw) && Array.isArray(raw.jobs),

  parse(raw, company) {
    if (!isObj(raw) || !Array.isArray(raw.jobs)) throw new ParseError('ashby: expected {"jobs": [...]}');
    const out: NormalizedJob[] = [];
    for (const j of raw.jobs) {
      if (!isObj(j)) continue;
      if (j.isListed === false) continue;
      const id = str(j.id);
      const title = str(j.title).trim();
      if (!id || !title) continue;

      const locations = [str(j.location)];
      // The structured address disambiguates "London" (ON vs UK) and adds the country.
      const postal = isObj(j.address) && isObj(j.address.postalAddress) ? j.address.postalAddress : null;
      if (postal) {
        locations.push(
          [str(postal.addressLocality), str(postal.addressRegion), str(postal.addressCountry)]
            .filter(Boolean)
            .join(', '),
        );
      }
      if (Array.isArray(j.secondaryLocations)) {
        for (const s of j.secondaryLocations) if (isObj(s)) locations.push(str(s.location));
      }
      const location = joinLocations(locations);

      out.push({
        atsJobId: id,
        company,
        title,
        location,
        url: str(j.jobUrl),
        description: str(j.descriptionPlain) || htmlToText(str(j.descriptionHtml)),
        postedAt: isoOrNull(j.publishedAt),
        departments: [str(j.department), str(j.team)].filter(Boolean),
        employmentType: str(j.employmentType) || null,
        remote: j.isRemote === true || /remote/i.test(str(j.workplaceType)) || /\bremote\b/i.test(location) ? true : null,
      });
    }
    return out;
  },
};
