# internBuddy roadmap

## What it is

Finds internships, co-ops and student roles (Toronto/GTA by default) on public company job
boards and, for each, suggests people worth talking to — as LinkedIn search links, never scraped
profiles. Runs on each person's own computer: no hosting, no accounts, no data leaving the
machine, and no AI required.

```
                         ┌──────────────────────────────┐
   web UI  (Phase 2) ────┤                              │
   MCP     (agents)  ────┤  core: ats · classify · rank ├──── SQLite (local)
   CLI     (cron)    ────┤        network · discovery   │
                         └──────────────┬───────────────┘
                                        │ optional
                                   llm/ providers (Phase 3)
```

Three ways to use it, all over the same core:

| Posture | Needs | Gets |
|---|---|---|
| **No AI** (default) | nothing | Everything: ranking with visible reasons, all links, tracking. |
| **Bring your own model** (Phase 3) | an API key, or Ollama | Semantic ranking against your résumé, drafted notes. |
| **Bring your own agent** | Claude Code / Desktop / any MCP client | Conversational: "what's new", "who do I know at Geotab". |

## Phase 1 — done (this branch)

- **Fetchers** for Greenhouse, Lever and Ashby: pure parsers plus one polite HTTP client
  (identifying User-Agent, per-host delay, timeout, retries on 429/5xx honouring Retry-After,
  ETag / If-Modified-Since).
- **Student-role classifier.** Internships, co-ops, PEY, work terms, "Summer Student",
  undergrad/grad research roles, Canadian term/duration titles ("Fall 2026 (4 months)"), and the
  board's own employment type. Rejects recruiters, intern-program staff, student-success roles and
  contracts. New-grad roles are tagged and hidden unless the profile opts in. Measured on
  ~21,000 real SimplifyJobs titles: catches ~88% of internship titles, admits <1% of new-grad ones.
- **Location matcher** that knows Burlington, MA is not Burlington, ON (and Cambridge, Aurora,
  Markham IL, Waterloo IA, Vancouver WA...).
- **Deterministic ranker** behind a `Ranker` interface: title matches ×3, rare terms weigh more
  (IDF), role types, location, recency, grad year, past employers, schools and clubs. Every point
  of score has a human-readable reason.
- **People to talk to:** LinkedIn searches from your schools (alumni page when you give the
  school's LinkedIn slug), clubs, past employers and hometown, then role-based searches: someone
  in the role, the likely manager, past interns, the university recruiter.
- **Company registry: 498 companies shipped.** 184 fetchable boards, 258 recorded on systems we
  can't fetch yet (227 of them Workday), 56 known by name for `discover` to resolve.
- **Discovery:** harvests real board tokens from SimplifyJobs' `listings.json` (Canada scope by
  default, `--scope all` for ~1,800 boards); resolves name-only companies by probing likely slugs
  (accepted only if postings name the company) and by reading the careers page (robots.txt
  respected); records Workday/SmartRecruiters/Workable boards for future adapters.
- **CLI** (`internbuddy`): init, where, scout, list, show, track, tracked, discover, companies,
  add, confirm, enable, export-registry. Scout writes a Markdown digest per run.
- **MCP server** (`internbuddy-mcp`): 12 tools and a `daily_review` prompt. Compact, paginated
  output; scans and discovery run in the background so tool calls never hang.
- **144 offline tests**, including one that fails the build if anything requests linkedin.com.

### Decisions made during the build

- **`node:sqlite` instead of `better-sqlite3`.** No native compile, so `npm install` can't fail
  on a missing toolchain and a future `.mcpb` bundle stays platform-independent. Costs: Node 22.13+.
- **Student roles only**, per the brief. New grad is an opt-in profile flag.
- **The board is the unit, not the posting.** SimplifyJobs is US-heavy (under 5% of its rows are
  Canadian), but a company listing a US internship often posts Toronto co-ops on the same board,
  and fetching the board returns everything. Location filtering happens per person.
- **"Seen" is interactive-only.** The daily cron scout never marks postings seen, so it can't
  swallow them before you look. Its digest shows postings *first found* in that run.
- **A board that has never worked and returns 404 is disabled immediately**; one that has worked
  gets three strikes. Network errors and 403s never disable anything.

### Not done from the Phase 1 plan

- **Toronto tech directories (TechTO, MaRS, Communitech) as discovery sources.** Their pages
  couldn't be inspected from the build environment, and a scraper written blind would be broken
  on arrival. SimplifyJobs' structured data turned out to be a far richer source anyway.
- **Live validation of the three parsers.** The job boards were blocked from the build
  environment, so parsers were written to the documented response shapes and tested against
  hand-built fixtures. Your first live `scout` is the real check — see below.

## Next, in order

1. **Workday adapter.** The biggest unlock for Canada: 227 recorded Workday boards, among them
   RBC, TD, CIBC, Autodesk and Sun Life — the large employers SimplifyJobs doesn't reach through
   Greenhouse, Lever or Ashby. No browser needed —
   Workday's `/wday/cxs/{tenant}/{site}/jobs` endpoint takes a POST and returns JSON. The registry
   already stores each board's tenant and site URL.
2. **Phase 2 — web UI** (`src/web/`): `node:http` bound to 127.0.0.1, server-rendered pages, no
   build step. Screens: jobs, job detail with people-to-talk-to, profile, companies, refresh with
   live progress, settings. This is what makes it usable with no agent at all.
3. **Phase 3 — bring your own model** (`src/llm/`): `rank()` and `draft()` over Anthropic,
   OpenAI, Google, Ollama, and one OpenAI-compatible adapter (covers OpenRouter, Groq, LM Studio,
   vLLM). An `LlmRanker` implements the existing `Ranker` interface. Default: none.
4. **Phase 4 — packaging for friends:** a `.mcpb` bundle (`mcpb init`, `mcpb pack`) that
   installs into Claude Desktop by drag-and-drop, and `npx internbuddy-mcp` for Claude Code.
5. SmartRecruiters and Workable adapters (31 more recorded boards).
6. Résumé-aware ranking; LinkedIn connections-CSV import ("you already know someone here");
   outreach log; assisted apply (drafts only, never submits).

## First run on your machine

```bash
# 1. get the code
git clone https://github.com/Tolatunji88/internBuddy.git
cd internBuddy
git checkout claude/adoring-ptolemy-ddid79

# 2. build, and prove the tests pass on your machine too
node --version            # needs v22.13 or newer
npm install
npm run build
npm test                  # 144 tests, all offline

# 3. make it yours
npm run init              # creates your profile and prints its path
#    edit that file: keywords, skills, locations, grad year,
#    and schools / clubs / past employers (these drive the LinkedIn links)

# 4. grow and confirm the company list (a few minutes)
npm run discover

# 5. first live fetch: the real validation of the parsers
npm run scout -- --limit 6

# 6. the whole thing, then again to prove the diff works
npm run scout             # every board; prints new matches and a digest path
npm run scout             # immediately again: should report 0 new

# 7. hand it to Claude Code
claude mcp add --scope user internbuddy -- node "$(pwd)/dist/mcp/main.js"
claude
#   /mcp                                  → internbuddy connected, 12 tools
#   /mcp__internbuddy__daily_review       → the whole flow
```

**After step 5, paste the output back into a session** — especially any posting with an empty
title, location or date, or a board that failed with a parse error. That's where a field-mapping
correction would show up, and the fix is usually a line or two.

**If `npm install` or `npm test` complains about `node:sqlite`,** your Node is older than 22.13.
Install the current LTS from nodejs.org.

**Optional daily run**, once you trust the output: see "Running it every morning" in the README.
