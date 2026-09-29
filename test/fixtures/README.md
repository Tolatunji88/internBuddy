# Test fixtures

- `simplify-listings.sample.json` — a real, trimmed slice of SimplifyJobs'
  `listings.json` (public company names and posting URLs only).
- `greenhouse.json`, `lever.json`, `ashby.json` — **hand-built** from each ATS's documented
  public response shape, because the job boards weren't reachable from the environment these
  were written in. Each includes the cases the code must handle: internships, senior roles,
  non-Canadian locations, entity-escaped HTML, unlisted postings.

When you can reach the boards, replace these with real recorded responses, trimmed to a handful
of postings. For example:

    curl -s "https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true" > greenhouse.json

The tests assert on behaviour (what's kept, how it's normalized), not on specific IDs, so a
real fixture should only need the expected counts and titles adjusted.
