import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer } from '../src/mcp/server.js';
import { insertCompany } from '../src/core/store.js';
import { AB, fixture, GH, LV, PROFILE, testCtx } from './helpers.js';

/** `profile: null` starts with no profile file at all. */
async function connect(profile: string | null = PROFILE) {
  const ctx = testCtx(
    {
      [`${GH}examplerobotics/`]: fixture('greenhouse.json'),
      [`${LV}examplelever`]: fixture('lever.json'),
      [`${AB}exampleashby`]: fixture('ashby.json'),
    },
    { profile: profile ?? undefined },
  );
  insertCompany(ctx.db, { name: 'Example Robotics', ats: 'greenhouse', atsToken: 'examplerobotics' });
  insertCompany(ctx.db, { name: 'Example Lever Co', ats: 'lever', atsToken: 'examplelever' });
  insertCompany(ctx.db, { name: 'Example Ashby', ats: 'ashby', atsToken: 'exampleashby' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(ctx).connect(serverSide);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
    return { text: r.content.map((c) => c.text).join('\n'), isError: r.isError === true };
  };
  return { ctx, client, call };
}

describe('MCP server', () => {
  it('lists every tool and the daily_review prompt', async () => {
    const { client } = await connect();
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      'add_company', 'discover_companies', 'get_overview', 'get_posting', 'get_profile', 'list_new_postings',
      'list_tracked', 'refresh_boards', 'search_postings', 'set_profile', 'set_status', 'suggest_connections',
    ]);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
    expect(prompts).toEqual(['daily_review']);
    const prompt = await client.getPrompt({ name: 'daily_review', arguments: { count: '5' } });
    const text = (prompt.messages[0]?.content as { text: string }).text;
    expect(text).toContain('Shortlist the 5 best fits');
    expect(text).toContain("Don't apply to anything or send any message on my behalf");
  });

  it('runs the whole flow: overview → refresh → new postings → detail → people → track', async () => {
    const { call } = await connect();

    expect((await call('get_overview')).text).toContain('Last scan: never');

    const refresh = await call('refresh_boards', { wait_seconds: 10 });
    expect(refresh.text).toContain('Checked 3 boards: 3 updated');
    expect(refresh.text).toMatch(/7 postings are new since the last scan; 4 match your profile/);

    const list = await call('list_new_postings', { limit: 2 });
    expect(list.text).toContain('Showing 1–2 of 4. More: cursor="2"');
    // Firmware + embedded terms put these two on top.
    expect(list.text).toMatch(/Firmware Engineering Intern|Embedded Software Developer/);
    expect(list.text).not.toMatch(/Hardware Co-op|San Francisco|New Grad|Product Design/);

    // Rows returned are marked seen, so the next call starts on the rest.
    const next = await call('list_new_postings', { limit: 10 });
    expect(next.text).toContain('Showing 1–2 of 2.');

    const id = Number(/#(\d+)/.exec(list.text)?.[1]);
    const detail = await call('get_posting', { id });
    expect(detail.text).toContain('Apply: https://');
    expect(detail.text).toMatch(/Match: score [\d.]+ — /);

    const people = await call('suggest_connections', { id });
    expect(people.text).toContain('Example University alumni at');
    expect(people.text).toContain('https://www.linkedin.com/school/example-university/people/?keywords=');
    expect(people.text).toContain('never contacts LinkedIn');

    expect((await call('set_status', { id, state: 'saved', notes: 'ask about ROS' })).text).toContain('marked saved');
    const tracked = await call('list_tracked');
    expect(tracked.text).toContain('SAVED (1)');
    expect(tracked.text).toContain('ask about ROS');
  });

  it('searches, including seen postings and outside your locations', async () => {
    const { call } = await connect();
    await call('refresh_boards', { wait_seconds: 10 });
    expect((await call('search_postings', { query: 'robotics' })).text).toContain('Robotics Research Intern');
    expect((await call('search_postings', { query: 'pcb' })).text).toContain('No open student roles match');
    expect((await call('search_postings', { query: 'pcb', any_location: true })).text).toContain('Hardware Co-op, Fall 2026');
  });

  it('edits the profile, and the change applies immediately', async () => {
    const { call } = await connect();
    await call('refresh_boards', { wait_seconds: 10 });
    const saved = await call('set_profile', { include_new_grad: true, locations: ['gta'] });
    expect(saved.text).toContain('include_new_grad: true');
    expect((await call('search_postings', { query: 'new grad' })).text).toContain('Software Engineer, New Grad (2027)');
    expect((await call('set_profile', { grad_year: 1800 })).isError).toBe(true);
  });

  it('tells the agent to set up a profile first when there is none', async () => {
    const { call } = await connect(null);
    expect((await call('get_overview')).text).toContain('help the user fill in their profile');
    expect((await call('get_profile')).text).toContain('No profile file yet');
  });

  it('returns errors for unknown ids instead of throwing', async () => {
    const { call } = await connect();
    const r = await call('get_posting', { id: 999 });
    expect(r).toEqual({ text: 'No posting #999.', isError: true });
  });

  it('refuses to start a second scan while one is running', async () => {
    const { ctx, call } = await connect();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { HttpClient } = await import('../src/core/ats/client.js');
    ctx.http = new HttpClient({
      minHostIntervalMs: 0,
      retries: 0,
      fetchImpl: async () => {
        await gate;
        return new Response('[]', { status: 200 });
      },
    });
    const first = await call('refresh_boards', { wait_seconds: 0 });
    expect(first.text).toContain('Scan started and still running');
    const second = await call('refresh_boards', { wait_seconds: 0 });
    expect(second.text).toContain('A scan is already running');
    release();
  });
});
