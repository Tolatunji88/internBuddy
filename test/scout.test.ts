import { describe, expect, it } from 'vitest';
import { scout } from '../src/core/scout.js';
import { getCompany, insertCompany, queryJobs } from '../src/core/store.js';
import { AB, fixture, GH, LV, testCtx } from './helpers.js';

function setup(routes: Record<string, unknown>) {
  const ctx = testCtx(routes);
  const gh = insertCompany(ctx.db, { name: 'Example Robotics', ats: 'greenhouse', atsToken: 'examplerobotics' });
  const lv = insertCompany(ctx.db, { name: 'Example Lever Co', ats: 'lever', atsToken: 'examplelever' });
  const ab = insertCompany(ctx.db, { name: 'Example Ashby', ats: 'ashby', atsToken: 'exampleashby' });
  return { ctx, gh, lv, ab };
}

const ROUTES = {
  [`${GH}examplerobotics/`]: fixture('greenhouse.json'),
  [`${LV}examplelever`]: fixture('lever.json'),
  [`${AB}exampleashby`]: fixture('ashby.json'),
};

describe('scout', () => {
  it('stores only student roles (and tags new-grad ones), across all three boards', async () => {
    const { ctx } = setup(ROUTES);
    const report = await scout(ctx);
    expect(report).toMatchObject({ boards: 3, ok: 3, failed: [], postingsSeen: 11 });

    const stored = queryJobs(ctx.db, { kinds: ['internship', 'new_grad'], includeSeen: true });
    const titles = stored.map((j) => `${j.kind}: ${j.title}`).sort();
    expect(titles).toEqual([
      'internship: Embedded Software Developer', // Lever commitment "Co-op"
      'internship: Firmware Engineering Intern (Summer 2027)',
      'internship: Hardware Co-op, Fall 2026',
      'internship: Machine Learning Intern',
      'internship: Product Design Intern',
      'internship: Robotics Research Intern',
      'new_grad: Software Engineer, New Grad (2027)',
    ]);
    // Never stored: senior roles, the intern program manager, full-time jobs, unlisted postings.
    expect(titles.join()).not.toMatch(/Senior|Program Manager|Data Analyst|Hidden|^internship: Software Engineer$/);
    expect(report.newJobIds).toHaveLength(7);
    expect(report.studentRoles).toBe(6);
    expect(report.newGradRoles).toBe(1);
  });

  it('reports nothing new on an immediate second run', async () => {
    const { ctx } = setup(ROUTES);
    await scout(ctx);
    const second = await scout(ctx);
    expect(second.newJobIds).toEqual([]);
    expect(second.closed).toBe(0);
  });

  it('closes postings that disappear from a board, and only that board', async () => {
    const gh = fixture('greenhouse.json') as { jobs: { id: number }[] };
    let serveAll = true;
    const { ctx } = setup({
      ...ROUTES,
      [`${GH}examplerobotics/`]: () =>
        new Response(JSON.stringify(serveAll ? gh : { jobs: gh.jobs.filter((j) => j.id !== 4001001) }), { status: 200 }),
    });
    await scout(ctx);
    serveAll = false;
    const report = await scout(ctx);
    expect(report.closed).toBe(1);
    const open = queryJobs(ctx.db, { kinds: ['internship'], includeSeen: true }).map((j) => j.title);
    expect(open).not.toContain('Firmware Engineering Intern (Summer 2027)');
    expect(open).toContain('Robotics Research Intern');
  });

  it('keeps jobs open when a board answers 304 Not Modified', async () => {
    let calls = 0;
    const { ctx } = setup({
      ...ROUTES,
      [`${GH}examplerobotics/`]: () =>
        ++calls === 1
          ? new Response(JSON.stringify(fixture('greenhouse.json')), { status: 200, headers: { etag: '"v1"' } })
          : new Response(null, { status: 304 }),
    });
    await scout(ctx);
    const report = await scout(ctx);
    expect(report.unchanged).toBe(1);
    expect(report.closed).toBe(0);
    expect(queryJobs(ctx.db, { kinds: ['internship'], includeSeen: true })).toHaveLength(6);
  });

  it('sends the stored ETag on the next request', async () => {
    const seen: (string | null)[] = [];
    const { ctx } = setup({ ...ROUTES });
    ctx.http = new (await import('../src/core/ats/client.js')).HttpClient({
      minHostIntervalMs: 0,
      retries: 0,
      fetchImpl: async (url, init) => {
        if (url.startsWith(GH)) {
          seen.push(new Headers(init?.headers).get('if-none-match'));
          return new Response(JSON.stringify(fixture('greenhouse.json')), { status: 200, headers: { etag: '"abc"' } });
        }
        return new Response('[]', { status: 200 });
      },
    });
    await scout(ctx, { companyIds: [1] });
    await scout(ctx, { companyIds: [1] });
    expect(seen).toEqual([null, '"abc"']);
  });

  it('disables a never-working board on its first 404, but gives a working board three strikes', async () => {
    const { ctx, gh, lv } = setup({ [`${AB}exampleashby`]: fixture('ashby.json') });
    const first = await scout(ctx);
    expect(first.failed.map((f) => f.company).sort()).toEqual(['Example Lever Co', 'Example Robotics']);
    expect(getCompany(ctx.db, gh)?.status).toBe('disabled');
    expect(getCompany(ctx.db, lv)?.status).toBe('disabled');

    // A board that has worked before: two failures keep it active, the third disables it.
    const ok = testCtx({ [`${AB}exampleashby`]: fixture('ashby.json') });
    const id = insertCompany(ok.db, { name: 'Example Ashby', ats: 'ashby', atsToken: 'exampleashby' });
    await scout(ok);
    ok.http = (await import('./helpers.js')).testHttp((await import('./helpers.js')).fakeFetch({}));
    await scout(ok);
    await scout(ok);
    expect(getCompany(ok.db, id)?.status).toBe('active');
    await scout(ok);
    expect(getCompany(ok.db, id)?.status).toBe('disabled');
  });

  it('records a malformed response as a failure instead of crashing the run', async () => {
    const { ctx } = setup({ ...ROUTES, [`${LV}examplelever`]: { unexpected: true } });
    const report = await scout(ctx);
    expect(report.ok).toBe(2);
    expect(report.failed).toEqual([{ company: 'Example Lever Co', error: 'lever: expected an array of postings' }]);
  });

  it('fetches least-recently-checked boards first when limited', async () => {
    const { ctx } = setup(ROUTES);
    await scout(ctx, { limit: 1 });
    const second = await scout(ctx, { limit: 2 });
    expect(second.boards).toBe(2);
    expect(ctx.fetch.calls).toHaveLength(3);
    expect(new Set(ctx.fetch.calls.map((u) => new URL(u).host)).size).toBe(3);
  });
});
