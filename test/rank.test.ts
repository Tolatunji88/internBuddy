import { describe, expect, it } from 'vitest';
import { DeterministicRanker } from '../src/core/match/rank.js';
import { selectAndRank } from '../src/core/match/select.js';
import type { Profile, StoredJob } from '../src/core/types.js';

const NOW = new Date('2026-09-29T12:00:00Z');

function job(id: number, over: Partial<StoredJob>): StoredJob {
  return {
    id, kind: 'internship', companyId: 1, company: 'Acme', ats: 'greenhouse', atsJobId: String(id),
    title: 'Intern', location: 'Toronto, ON', url: '', description: '', postedAt: '2026-09-01T00:00:00Z',
    firstSeenAt: '2026-09-01T00:00:00Z', lastSeenAt: '2026-09-29T00:00:00Z', isOpen: true, remote: null,
    employmentType: null, departments: [], seen: false, state: null, notes: null, ...over,
  };
}

const profile: Profile = {
  keywords: ['embedded', 'firmware'], skills: ['python', 'ros'], roleTypes: ['hardware'], excludeKeywords: ['sales'],
  locations: ['gta', 'ontario', 'remote-canada'], gradYear: 2028, schools: [{ name: 'Example University' }],
  clubs: ['Example Robotics Club'], pastEmployers: ['Northwind Systems'], includeNewGrad: false,
};

describe('DeterministicRanker', () => {
  const ranker = new DeterministicRanker();

  it('explains every point of score', () => {
    const [r] = ranker.rank(
      [job(1, { title: 'Firmware Intern', description: 'Python and ROS. Open to the class of 2028.', postedAt: '2026-09-28T00:00:00Z' })],
      profile,
      NOW,
    );
    expect(r?.reasons).toEqual([
      'title mentions "firmware"',
      'description mentions "python" and "ros"',
      'in GTA',
      'posted 1 day ago',
      'mentions 2028',
    ]);
    expect(r?.matched).toEqual(['firmware', 'python', 'ros']);
  });

  it('weights title matches over description matches', () => {
    const ranked = ranker.rank(
      [job(1, { title: 'Software Intern', description: 'embedded work' }), job(2, { title: 'Embedded Software Intern', description: '' })],
      profile,
      NOW,
    );
    expect(ranked[0]?.job.id).toBe(2);
  });

  it('weights rare terms over common ones', () => {
    // "python" is everywhere, "ros" is in one posting: the ROS posting should win.
    const jobs = [
      job(1, { description: 'python' }),
      job(2, { description: 'python' }),
      job(3, { description: 'python' }),
      job(4, { description: 'ros' }),
    ];
    expect(ranker.rank(jobs, profile, NOW)[0]?.job.id).toBe(4);
  });

  it('boosts past employers, schools and clubs', () => {
    const [r] = ranker.rank(
      [job(1, { company: 'Northwind Systems Inc.', description: 'We hire from Example University and the Example Robotics Club.' })],
      profile,
      NOW,
    );
    expect(r?.reasons).toEqual(
      expect.arrayContaining(["you've worked at Northwind Systems", 'mentions Example University', 'mentions Example Robotics Club']),
    );
  });

  it('penalizes stale postings', () => {
    const [r] = ranker.rank([job(1, { postedAt: '2026-06-01T00:00:00Z' })], profile, NOW);
    expect(r?.reasons).toContain('posted over 2 months ago');
    expect(r?.score).toBeLessThan(1);
  });
});

describe('selectAndRank', () => {
  const ranker = new DeterministicRanker();
  const jobs = [
    job(1, { title: 'Firmware Intern', location: 'Toronto, ON' }),
    job(2, { title: 'Firmware Intern', location: 'Austin, TX' }),
    job(3, { title: 'Sales Intern', location: 'Toronto, ON' }),
    job(4, { title: 'Firmware Engineer, New Grad', kind: 'new_grad', location: 'Toronto, ON' }),
    job(5, { title: 'Robotics Intern', company: 'Kepler', location: 'Toronto, ON', description: 'satellite "ground station"' }),
  ];

  it('keeps student roles in your locations, minus excluded titles', () => {
    expect(selectAndRank(jobs, profile, ranker, {}, NOW).map((r) => r.job.id).sort()).toEqual([1, 5]);
  });

  it('shows new-grad roles only when the profile opts in', () => {
    const ids = selectAndRank(jobs, { ...profile, includeNewGrad: true }, ranker, {}, NOW).map((r) => r.job.id);
    expect(ids).toContain(4);
  });

  it('filters by query words, phrases and company', () => {
    expect(selectAndRank(jobs, profile, ranker, { query: '"ground station"' }, NOW).map((r) => r.job.id)).toEqual([5]);
    expect(selectAndRank(jobs, profile, ranker, { company: 'kep' }, NOW).map((r) => r.job.id)).toEqual([5]);
  });

  it('can ignore location preferences', () => {
    expect(selectAndRank(jobs, profile, ranker, { anyLocation: true }, NOW).map((r) => r.job.id)).toContain(2);
  });
});
