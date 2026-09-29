import { describe, expect, it } from 'vitest';
import { extractCandidates } from '../src/core/discovery/bootstrap.js';
import { detectBoards } from '../src/core/discovery/detect.js';
import { discover } from '../src/core/discovery/discover.js';
import { candidateSlugs, resolveCompany } from '../src/core/discovery/resolve.js';
import { isAllowedByRobots, RobotsCache } from '../src/core/discovery/robots.js';
import { findCompanyByBoard, insertCompany, listCompanies } from '../src/core/store.js';
import { AB, fakeFetch, fixture, GH, LV, testCtx, testHttp } from './helpers.js';

describe('detectBoards', () => {
  it('finds every supported and unsupported board form', () => {
    const html = `
      <a href="https://boards.greenhouse.io/cloudflare/jobs/8199958?utm_source=Simplify">Apply</a>
      <a href="https://job-boards.greenhouse.io/embed/job_app?for=coinbase&token=123">Apply</a>
      <script src="https://boards.greenhouse.io/embed/job_board/js?for=geotab"></script>
      <a href="https://jobs.lever.co/kepler/abc-123/apply">Apply</a>
      <a href="https://jobs.ashbyhq.com/Remedy%20Scientific/2e74c46f">Apply</a>
      <a href="https://rbc.wd3.myworkdayjobs.com/rbcglobal1/job/TORONTO/Intern_R-1">Apply</a>
      <a href="https://autodesk.wd1.myworkdayjobs.com/en-US/Ext/job/Toronto/PhD">Apply</a>
      <a href="https://apply.workable.com/j/ABC123">shortlink, not a board</a>`;
    expect(detectBoards(html)).toEqual([
      { ats: 'greenhouse', token: 'coinbase', careersUrl: null },
      { ats: 'greenhouse', token: 'geotab', careersUrl: null },
      { ats: 'greenhouse', token: 'cloudflare', careersUrl: null },
      { ats: 'lever', token: 'kepler', careersUrl: null },
      { ats: 'ashby', token: 'Remedy Scientific', careersUrl: null },
      { ats: 'workday', token: 'rbc', careersUrl: 'https://rbc.wd3.myworkdayjobs.com/rbcglobal1' },
      { ats: 'workday', token: 'autodesk', careersUrl: 'https://autodesk.wd1.myworkdayjobs.com/Ext' },
    ]);
  });
});

describe('extractCandidates (real SimplifyJobs data)', () => {
  const candidates = extractCandidates(fixture('simplify-listings.sample.json'), 'simplify-test');
  const byToken = (t: string) => candidates.find((c) => c.token.toLowerCase() === t.toLowerCase());

  it('groups listings into boards and flags Canadian ones', () => {
    expect(byToken('leagueinc')).toMatchObject({ ats: 'greenhouse', name: 'League', canada: true });
    expect(byToken('athinkingape')?.canada).toBe(true); // "Remote in Canada"
    expect(byToken('neuralink')).toMatchObject({ ats: 'greenhouse', canada: false });
    // Listed as "Remote in USA" *and* "Remote in Canada": any Canadian location counts.
    expect(byToken('1password')).toMatchObject({ ats: 'ashby', listings: 2, canada: true });
    expect(byToken('anthropic')?.canada).toBe(true);
  });

  it('records Workday boards with where they live, for a future adapter', () => {
    expect(byToken('rbc')).toMatchObject({ ats: 'workday', canada: true, careersUrl: 'https://rbc.wd3.myworkdayjobs.com/rbcglobal1' });
  });

  it('decodes URL-encoded tokens and ignores boards it cannot identify', () => {
    expect(byToken('Remedy Scientific')?.ats).toBe('ashby');
    expect(candidates.some((c) => c.token === 'embed' || c.token === 'eaton')).toBe(false);
  });
});

describe('candidateSlugs', () => {
  it('derives plausible tokens from the name and domain', () => {
    expect(candidateSlugs('MDA Space', 'mda.space')).toEqual(['mdaspace', 'mda-space', 'mda']);
    expect(candidateSlugs('Kepler Communications Inc.')).toEqual(['keplercommunications', 'kepler-communications', 'keplercommunicationsinc', 'kepler']);
    expect(candidateSlugs('1Password', '1password.com')).toEqual(['1password']);
  });
});

describe('robots.txt', () => {
  const txt = `
User-agent: *
Disallow: /careers/private
Allow: /careers/private/public$
Disallow: /*.pdf$

User-agent: internbuddy
Disallow: /secret`;
  it('applies our own group when there is one', () => {
    expect(isAllowedByRobots(txt, '/secret/page')).toBe(false);
    expect(isAllowedByRobots(txt, '/careers/private')).toBe(true);
  });
  it('falls back to * with longest-match and wildcards', () => {
    expect(isAllowedByRobots(txt, '/careers/private/x', 'otherbot')).toBe(false);
    expect(isAllowedByRobots(txt, '/careers/private/public', 'otherbot')).toBe(true);
    expect(isAllowedByRobots(txt, '/files/a.pdf', 'otherbot')).toBe(false);
    expect(isAllowedByRobots(txt, '/careers', 'otherbot')).toBe(true);
  });
});

describe('resolveCompany', () => {
  const gh = fixture('greenhouse.json');

  it('accepts a slug whose postings name the company', async () => {
    const http = testHttp(fakeFetch({ [`${GH}examplerobotics/`]: gh }));
    const out = await resolveCompany(http, new RobotsCache(http), { name: 'Example Robotics' });
    expect(out).toMatchObject({ status: 'active', ats: 'greenhouse', token: 'examplerobotics' });
  });

  it('flags a board under a guessed slug that never names the company', async () => {
    const http = testHttp(fakeFetch({ [`${LV}ada`]: fixture('lever.json') }));
    const out = await resolveCompany(http, new RobotsCache(http), { name: 'Ada' });
    expect(out).toMatchObject({ status: 'needs_review', ats: 'lever', token: 'ada' });
  });

  it('follows the careers page, and respects robots.txt', async () => {
    const page = '<html><a href="https://jobs.ashbyhq.com/acmecareers/123">Jobs</a></html>';
    const allowed = testHttp(fakeFetch({ 'https://acme.io/careers': page, [`${AB}acmecareers`]: fixture('ashby.json') }));
    expect(await resolveCompany(allowed, new RobotsCache(allowed), { name: 'Acme', domain: 'acme.io' })).toMatchObject({
      status: 'active', ats: 'ashby', token: 'acmecareers',
    });

    const fetch = fakeFetch({
      'https://acme.io/robots.txt': 'User-agent: *\nDisallow: /careers\nDisallow: /jobs',
      'https://www.acme.io/robots.txt': 'User-agent: *\nDisallow: /',
      'https://acme.io/careers': page,
    });
    const blocked = testHttp(fetch);
    expect((await resolveCompany(blocked, new RobotsCache(blocked), { name: 'Acme', domain: 'acme.io' })).status).toBe('unresolved');
    expect(fetch.calls).not.toContain('https://acme.io/careers');
  });

  it('records an unsupported ATS from the careers page', async () => {
    const http = testHttp(fakeFetch({ 'https://bank.ca/careers': '<a href="https://bank.wd3.myworkdayjobs.com/Careers/job/1">x</a>' }));
    expect(await resolveCompany(http, new RobotsCache(http), { name: 'Bank', domain: 'bank.ca' })).toMatchObject({
      status: 'unsupported', ats: 'workday', careersUrl: 'https://bank.wd3.myworkdayjobs.com/Careers',
    });
  });
});

describe('discover', () => {
  const SOURCE = [{ id: 'simplify-test', urls: ['https://example.test/listings.json'] }];

  it('adds verified Canadian boards, drops dead ones, records unsupported ones', async () => {
    const ctx = testCtx({
      'https://example.test/listings.json': fixture('simplify-listings.sample.json'),
      [`${GH}leagueinc/jobs`]: { jobs: [] },
      [`${GH}athinkingape/jobs`]: { jobs: [] },
      [`${GH}anthropic/jobs`]: { jobs: [] },
      [`${GH}kensingtontours/jobs`]: { status: 404 },
      [`${LV}`]: [],
      [`${AB}`]: { jobs: [] },
    });
    insertCompany(ctx.db, { name: 'League', domain: 'league.com' }); // known by name only
    const r = await discover(ctx, { sources: SOURCE });

    expect(r.sourcesOk).toEqual(['simplify-test']);
    expect(r.deadBoards).toBe(1);
    expect(r.upgraded).toBe(1);
    expect(findCompanyByBoard(ctx.db, 'greenhouse', 'leagueinc')).toMatchObject({ name: 'League', status: 'active', domain: 'league.com' });
    expect(findCompanyByBoard(ctx.db, 'greenhouse', 'kensingtontours')).toBeNull();
    expect(findCompanyByBoard(ctx.db, 'workday', 'rbc')?.status).toBe('unsupported');
    // Canada scope by default: US-only boards stay out.
    expect(findCompanyByBoard(ctx.db, 'greenhouse', 'neuralink')).toBeNull();
  });

  it('scope "all" takes every board', async () => {
    const ctx = testCtx({
      'https://example.test/listings.json': fixture('simplify-listings.sample.json'),
      [GH]: { jobs: [] }, [LV]: [], [AB]: { jobs: [] },
    });
    await discover(ctx, { sources: SOURCE, scope: 'all' });
    expect(findCompanyByBoard(ctx.db, 'greenhouse', 'neuralink')?.status).toBe('active');
  });

  it('reports a source that fails without failing the whole run', async () => {
    const ctx = testCtx({});
    const r = await discover(ctx, { sources: SOURCE });
    expect(r.sourceErrors).toEqual([{ id: 'simplify-test', error: 'HTTP 404' }]);
  });

  it('marks a company resolved to an already-tracked board as a duplicate', async () => {
    const ctx = testCtx({ [`${GH}examplerobotics/`]: fixture('greenhouse.json') });
    insertCompany(ctx.db, { name: 'Example Robotics Corp', ats: 'greenhouse', atsToken: 'examplerobotics' });
    insertCompany(ctx.db, { name: 'Example Robotics' });
    await discover(ctx, { bootstrap: false });
    const dupes = listCompanies(ctx.db).filter((c) => c.name === 'Example Robotics');
    expect(dupes[0]).toMatchObject({ status: 'disabled', lastError: 'duplicate of Example Robotics Corp' });
  });
});
