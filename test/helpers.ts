import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type FetchLike, HttpClient } from '../src/core/ats/client.js';
import { type Ctx, openContext } from '../src/core/context.js';

export const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
export const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

export type Route = unknown | { status: number; body?: unknown; headers?: Record<string, string> } | ((url: string) => Response);

/** A fetch that serves canned responses by URL prefix and records every request. */
export function fakeFetch(routes: Record<string, Route>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes)
      .filter((k) => url.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (key === undefined) return new Response('not found', { status: 404 });
    const route = routes[key];
    if (typeof route === 'function') return (route as (u: string) => Response)(url);
    if (route && typeof route === 'object' && 'status' in route && typeof (route as { status: unknown }).status === 'number') {
      const r = route as { status: number; body?: unknown; headers?: Record<string, string> };
      const body = r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      return new Response(r.status === 304 ? null : body, { status: r.status, headers: r.headers });
    }
    return new Response(typeof route === 'string' ? route : JSON.stringify(route), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export function testHttp(fetchImpl: FetchLike): HttpClient {
  return new HttpClient({ fetchImpl, minHostIntervalMs: 0, retries: 0, sleep: async () => {} });
}

export function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'internbuddy-test-'));
}

/** A fully isolated context: temp home, in-memory database, fake network, empty registry. */
export function testCtx(routes: Record<string, Route> = {}, opts: { profile?: string } = {}): Ctx & { fetch: ReturnType<typeof fakeFetch>; home: string } {
  const home = tempHome();
  if (opts.profile !== undefined) fs.writeFileSync(path.join(home, 'profile.yaml'), opts.profile, 'utf8');
  const fetch = fakeFetch(routes);
  const ctx = openContext({ env: { INTERNBUDDY_HOME: home }, dbFile: ':memory:', http: testHttp(fetch), syncRegistry: false });
  return Object.assign(ctx, { fetch, home });
}

export const PROFILE = `
name: Test Student
keywords: [embedded, robotics, firmware]
skills: [python, c++, ros]
role_types: [software, hardware]
exclude_keywords: [sales]
locations: [gta, ontario, remote-canada]
grad_year: 2028
schools:
  - name: University of Toronto
    linkedin: university-of-toronto
clubs: [University of Toronto Aerospace Team]
past_employers: [Example Lever Co]
hometown: Toronto
`;

export const GH = 'https://boards-api.greenhouse.io/v1/boards/';
export const LV = 'https://api.lever.co/v0/postings/';
export const AB = 'https://api.ashbyhq.com/posting-api/job-board/';
