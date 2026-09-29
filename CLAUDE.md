# internBuddy

Finds internships, co-ops and other student roles (Toronto/GTA by default) on public company
job boards, and for each one suggests people worth talking to — as LinkedIn *search links* the
user clicks. Runs entirely on each person's own computer. AI is optional.

Read `ROADMAP.md` for the phase plan and what's next.

## Non-negotiable rules

- **Never send a request to LinkedIn or Indeed.** We only build search URLs as strings.
  `test/network.test.ts` fails the build if anything in `src/` requests linkedin.com.
- **Never auto-submit an application or send a message.** Draft; the person sends.
- **Student roles only.** `classifyRole` decides; full-time new-grad roles are stored but hidden
  unless the profile sets `include_new_grad: true`. Staff jobs *about* interns (recruiters,
  program managers) and jobs *serving* students never count. Precision beats recall.
- **Be a polite client.** All network access goes through `HttpClient` (`src/core/ats/client.ts`):
  identifying User-Agent, per-host delay, timeout, bounded retries honouring Retry-After,
  conditional requests. Careers pages (the only non-ATS pages we read) check robots.txt.
- **Personal data never enters the repo.** Profile, database and reports live in the per-user
  home (`internbuddy where`), never in the working tree. Don't commit fixtures containing people.
- **No token is trusted unconfirmed.** A guessed board slug is `needs_review` until its postings
  name the company or the company's careers page links it.
- **No AI provider is contacted** unless the user configures one (not built yet; Phase 3).

## Architecture

One core, thin faces. Faces hold no logic — if the CLI and MCP server both need it, it's core.

```
src/core/
  ats/          greenhouse, lever, ashby: pure (rawJson) => NormalizedJob[]; client.ts = all HTTP
  match/        classify.ts (student-role gate), location.ts, rank.ts (Ranker interface), select.ts
  network/      linkedin.ts + titles.ts: string building only, zero requests
  discovery/    bootstrap.ts (SimplifyJobs listings.json), resolve.ts (slug probe + careers page), discover.ts
  db.ts store.ts   node:sqlite, migrations via PRAGMA user_version, all SQL in store.ts
  profile.ts    YAML profile; edits preserve comments
  registry.ts   data/companies.csv <-> database
  scout.ts      fetch -> classify -> ingest -> close
  views.ts report.ts   shared text output
src/cli.ts      `internbuddy` (daily run + management)
src/mcp/        `internbuddy-mcp` (stdio): server.ts registers, tools.ts handles
```

## Commands

```bash
npm run build        # tsc -> dist/
npm test             # vitest, fully offline
npm run typecheck    # src + test
npm run inspect      # MCP inspector against dist/mcp/main.js
node dist/cli.js help
```

## Conventions and gotchas

- **Nothing reachable from the MCP server may write to stdout** — stdout is the protocol. Core
  modules never `console.log`; they report through return values and `onProgress` callbacks.
- **Paths never depend on cwd.** The MCP server starts wherever the agent was launched. Use
  `resolvePaths()` (per-user home) and `PACKAGE_ROOT` (shipped files).
- **`node:sqlite` is loaded lazily** via `createRequire` in `db.ts` so `quiet.ts` can filter its
  ExperimentalWarning first. Every entry point imports `./core/quiet.js` before anything else.
  Requires Node 22.13+. node:sqlite rejects `undefined` and booleans: pass `null` and 0/1.
- **Parsers are pure and tested against fixtures.** `test/fixtures/{greenhouse,lever,ashby}.json`
  are hand-built from documented shapes; replace them with recorded responses when you can
  (see `test/fixtures/README.md`). Tests never touch the network: use `testCtx()`/`fakeFetch()`.
- **MCP tool output is compact and paginated.** Never return hundreds of rows; `get_posting` is
  the only tool that returns a long description. Long jobs (scan, discovery) run in the
  background and the tool returns progress after `wait_seconds`.
- **Changing the classifier or location matcher?** Re-check against real titles: the SimplifyJobs
  `listings.json` files are a free labelled dataset (internship vs new-grad lists). The current
  classifier catches ~88% of internship titles and admits <1% of new-grad titles.
- **Growing the shared company list:** `internbuddy discover`, then `internbuddy export-registry`,
  review the diff of `data/companies.csv`, commit.
- Cloud sessions may have the job-board hosts blocked by their network policy (403 at the proxy).
  Build against fixtures there; live runs happen on a local machine.
