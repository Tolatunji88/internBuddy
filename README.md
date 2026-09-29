# internBuddy

Finds **internships, co-ops and student roles** in Toronto and the GTA (or wherever you choose)
on hundreds of company job boards, ranks them for you, and for each one suggests **people worth
talking to** — so the job and the path to a referral arrive together.

- **Runs on your computer.** No account, no server. Your profile and history never leave your machine.
- **No AI required.** Ranking is transparent: it tells you exactly which of your words matched.
- **Works with your AI agent** (Claude Code, Claude Desktop, any MCP client) if you want to chat with it.
- **Never touches LinkedIn.** It builds LinkedIn *search links* you open yourself. It never
  applies to anything or messages anyone.

## Setup

Needs [Node.js](https://nodejs.org) **22.13 or newer**.

```bash
git clone https://github.com/Tolatunji88/internBuddy.git
cd internBuddy
npm install
npm run build
npm run init        # creates your profile and prints where it lives — edit it
npm run discover    # one-time: confirms and grows the company list (a few minutes)
npm run scout       # checks every board; prints new matches and writes a digest
```

## Your profile

`npm run init` copies [`config/profile.example.yaml`](config/profile.example.yaml) to your
personal folder (`node dist/cli.js where` shows it). The comments in it explain every field. The
important ones:

- `keywords`, `skills`, `role_types` — what makes a posting a good fit.
- `locations` — `gta`, `ontario`, `remote-canada`, `canada`, `remote`, or any place name.
- `schools`, `clubs`, `past_employers` — these build the people-to-talk-to searches, e.g.
  "University of Toronto alumni at Geotab".
- `include_new_grad` — off by default; turn on if you're graduating and want full-time roles too.

## Using it with Claude Code

```bash
claude mcp add --scope user internbuddy -- node "$(pwd)/dist/mcp/main.js"
```

(On Windows, replace `$(pwd)` with the full path to your internBuddy folder.)

Then start `claude`, check `/mcp` shows internbuddy connected, and run the daily review prompt
(`/mcp__internbuddy__daily_review`) or just ask: *"what's new today?"*, *"who should I talk to
about the Geotab co-op?"*, *"draft a note to someone from my design team there"*.

## Commands

```
internbuddy scout [--limit N]         check boards, store new student roles, write a digest
internbuddy list [--all] [--query Q]  ranked postings
internbuddy show ID                   full posting, why it matched, people to talk to
internbuddy track ID saved|applied|interviewing|offer|rejected|archived
internbuddy tracked                   what you've saved and applied to
internbuddy discover [--scope all]    grow the company list
internbuddy add "Company" --domain example.com
internbuddy companies                 everything being tracked
```

Run them as `node dist/cli.js <command>`, or `npm link` once to get the `internbuddy` command.

## Running it every morning

Once you trust the output, schedule `scout`. On macOS or Linux, `crontab -e` and add:

```
0 7 * * * cd /path/to/internBuddy && /path/to/node dist/cli.js scout >> scout.log 2>&1
```

Use the output of `which node` for `/path/to/node` — cron doesn't load your shell, so a bare
`node` often isn't found. On Windows, create a Task Scheduler task that runs
`node dist\cli.js scout` in the folder.

## How it finds companies

`data/companies.csv` ships with about 500 companies. Board links were harvested from the
[SimplifyJobs](https://github.com/SimplifyJobs) internship and new-grad lists (every posting URL
there names a real job board), filtered to boards that have posted in Canada, plus a hand-picked
list of GTA employers. `discover` confirms them and finds boards for the rest.

It reads Greenhouse, Lever and Ashby boards today. Companies on Workday, SmartRecruiters and
Workable (including RBC, TD and CIBC) are recorded and will be picked up when those adapters
land — see [ROADMAP.md](ROADMAP.md).

Found good companies? `internbuddy export-registry` writes your list back to
`data/companies.csv` so you can share it.

## Privacy

Everything personal — profile, database, digests — lives in your per-user folder, never in this
repo. Delete that folder and it's gone. internBuddy only contacts public job-board APIs, company
careers pages (respecting robots.txt), and GitHub for the SimplifyJobs lists.
