import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Ctx } from '../core/context.js';
import { TRACK_STATES } from '../core/types.js';
import { createHandlers, type ToolResult } from './tools.js';

export const SERVER_NAME = 'internbuddy';
export const SERVER_VERSION = '0.1.0';

const INSTRUCTIONS = `internBuddy finds internships, co-ops and other student roles (Toronto/GTA by default) on public company job boards, stored locally on this computer.

- Start with get_overview. If the profile is missing or empty, help the user fill it in with set_profile before ranking anything.
- Lists are compact and paginated; call get_posting for one full description rather than asking for more rows.
- suggest_connections returns LinkedIn *search links* for the user to open. Never claim to have contacted, found, or looked up a person.
- Never apply to a job or send a message on the user's behalf. Draft; the user sends.`;

const text = (r: ToolResult) => ({ content: [{ type: 'text' as const, text: r.text }], isError: r.isError });

const cursor = z.string().optional().describe('Pagination cursor from a previous call\'s "More:" line.');
const limit = z.number().int().min(1).max(50).optional().describe('Rows per page (default 10).');
const jobId = z.number().int().positive().describe('Posting id, the number after # in lists.');
const stringList = z.array(z.string().min(1));

export function createServer(ctx: Ctx): McpServer {
  const h = createHandlers(ctx);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'get_overview',
    {
      title: 'Overview',
      description: 'Profile status, how many boards are tracked, how many postings are stored and unseen, and when the last scan ran. Call this first.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => text(await h.getOverview()),
  );

  server.registerTool(
    'list_new_postings',
    {
      title: 'New postings',
      description:
        'Student roles you have not seen yet that match your profile and locations, best first. Marks the returned rows as seen, so the next call shows the next batch.',
      inputSchema: {
        limit,
        cursor,
        mark_seen: z.boolean().optional().describe('Mark returned postings as seen (default true).'),
      },
    },
    async (a) => text(await h.listNewPostings(a)),
  );

  server.registerTool(
    'search_postings',
    {
      title: 'Search postings',
      description: 'Search stored student roles, ranked for the profile. Every word in `query` must appear; use "quotes" for phrases.',
      inputSchema: {
        query: z.string().optional().describe('Words that must all appear, e.g. `firmware "c++"`.'),
        company: z.string().optional(),
        posted_within_days: z.number().int().min(0).optional(),
        include_seen: z.boolean().optional().describe('Include postings already seen (default true).'),
        any_location: z.boolean().optional().describe("Ignore the profile's location preferences."),
        limit,
        cursor,
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => text(await h.searchPostings(a)),
  );

  server.registerTool(
    'get_posting',
    {
      title: 'Posting details',
      description: 'Full description, apply link, match reasons and tracking state for one posting.',
      inputSchema: { id: jobId },
    },
    async (a) => text(await h.getPosting(a)),
  );

  server.registerTool(
    'suggest_connections',
    {
      title: 'People to talk to',
      description:
        "LinkedIn search links for people worth reaching about a posting: shared school/club/employer first, then roles (someone in the role, the likely manager, past interns, the university recruiter). Links only; nothing is looked up.",
      inputSchema: { id: jobId },
      annotations: { readOnlyHint: true },
    },
    async (a) => text(await h.suggestConnections(a)),
  );

  server.registerTool(
    'set_status',
    {
      title: 'Track a posting',
      description: 'Mark a posting saved, applied, interviewing, offer, rejected or archived, with optional notes.',
      inputSchema: {
        id: jobId,
        state: z.enum(TRACK_STATES as [string, ...string[]]).describe(TRACK_STATES.join(' | ')),
        notes: z.string().optional(),
      },
    },
    async (a) => text(await h.setStatus(a as Parameters<typeof h.setStatus>[0])),
  );

  server.registerTool(
    'list_tracked',
    {
      title: 'Tracked postings',
      description: 'Postings you have saved or applied to, grouped by state.',
      inputSchema: { state: z.enum(TRACK_STATES as [string, ...string[]]).optional() },
      annotations: { readOnlyHint: true },
    },
    async (a) => text(await h.listTracked(a as Parameters<typeof h.listTracked>[0])),
  );

  server.registerTool(
    'get_profile',
    {
      title: 'Get profile',
      description: 'The profile that drives filtering, ranking and the people-to-talk-to links.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => text(await h.getProfile()),
  );

  server.registerTool(
    'set_profile',
    {
      title: 'Update profile',
      description:
        'Update profile fields. Lists REPLACE the existing list, so to add one item call get_profile first and send the full list. Send null to clear a field. Comments in the file are preserved.',
      inputSchema: {
        name: z.string().nullable().optional(),
        keywords: stringList.nullable().optional().describe('Words that make a posting a good fit.'),
        skills: stringList.nullable().optional().describe('Languages and tools, e.g. python, c++, ros.'),
        role_types: stringList.nullable().optional().describe('Broad areas, e.g. software, hardware, electrical.'),
        exclude_keywords: stringList.nullable().optional().describe('Hide postings whose title contains these.'),
        locations: stringList
          .nullable()
          .optional()
          .describe('gta, ontario, remote-canada, canada, remote, any — or place names like waterloo.'),
        grad_year: z.number().int().min(1990).max(2100).nullable().optional(),
        include_new_grad: z.boolean().nullable().optional().describe('Also show full-time new-grad roles.'),
        schools: z
          .array(z.union([z.string().min(1), z.object({ name: z.string().min(1), linkedin: z.string().min(1).optional() })]))
          .nullable()
          .optional()
          .describe('Schools; `linkedin` is the slug after linkedin.com/school/, enabling alumni-page links.'),
        clubs: stringList.nullable().optional().describe('Clubs, design teams, societies.'),
        past_employers: stringList.nullable().optional(),
        hometown: z.string().nullable().optional(),
      },
    },
    async (a) => text(await h.setProfile(a)),
  );

  server.registerTool(
    'refresh_boards',
    {
      title: 'Scan job boards',
      description:
        "Fetch every tracked company's job board and store new student roles. A full scan takes a minute or two, so this waits up to wait_seconds and then returns while the scan keeps going; call it again for progress. Never starts a second scan.",
      inputSchema: {
        limit: z.number().int().min(1).optional().describe('Only the N least-recently checked boards.'),
        companies: stringList.optional().describe('Only these companies.'),
        wait_seconds: z.number().int().min(0).max(120).optional().describe('How long to wait before returning (default 20).'),
      },
    },
    async (a) => text(await h.refreshBoards(a)),
  );

  server.registerTool(
    'discover_companies',
    {
      title: 'Discover companies',
      description:
        "Grow the list of tracked companies: harvest real job-board links from the SimplifyJobs lists (scope 'canada' by default, 'all' for every board), and look up boards for companies known only by name. Takes a few minutes; returns progress if still running.",
      inputSchema: {
        scope: z.enum(['canada', 'all']).optional(),
        names: stringList.optional().describe('Only look up these companies.'),
        wait_seconds: z.number().int().min(0).max(120).optional(),
      },
    },
    async (a) => text(await h.discoverCompanies(a)),
  );

  server.registerTool(
    'add_company',
    {
      title: 'Add a company',
      description: "Start tracking a company by name. Finds its job board by name and via its careers page (give the domain for best results).",
      inputSchema: {
        name: z.string().min(1),
        domain: z.string().optional().describe('e.g. geotab.com'),
        careers_url: z.string().url().optional(),
        wait_seconds: z.number().int().min(0).max(120).optional(),
      },
    },
    async (a) => text(await h.addCompany(a)),
  );

  server.registerPrompt(
    'daily_review',
    {
      title: 'Daily internship review',
      description: 'Scan the boards, pick the best new student roles for you, and line up people to talk to.',
      argsSchema: { count: z.string().optional().describe('How many roles to shortlist (default 3).') },
    },
    ({ count }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: dailyReviewPrompt(Number.parseInt(count ?? '3', 10) || 3),
          },
        },
      ],
    }),
  );

  return server;
}

export function dailyReviewPrompt(n: number): string {
  return `Run my internBuddy daily review.

1. Call get_overview. If my profile is missing or has no keywords, skills or role types, stop and help me fill it in with set_profile first: ask what roles I want, my skills, where I'd work, my graduation year, and my schools, clubs and past employers (those drive the networking links).
2. Call refresh_boards. If it's still running when it returns, carry on with what's stored and tell me.
3. Call list_new_postings (limit 15). If there's nothing new, say so and suggest search_postings over recent postings instead.
4. Shortlist the ${n} best fits for me. Read my profile (get_profile) and each candidate's full description (get_posting). Look past keyword overlap: a role titled unexpectedly can be a great fit for my background. For each, say in one or two sentences why it fits, and flag anything that rules it out (degree level, citizenship, term dates).
5. For each shortlisted role, call suggest_connections, pick the two most promising searches, and draft a LinkedIn connection note under 300 characters that names a real overlap (school, club, past employer, or the specific team or work). Never invent an overlap or claim to know someone.
6. Ask me which to save, then mark them with set_status.

Don't apply to anything or send any message on my behalf. I open the links and send notes myself.`;
}
