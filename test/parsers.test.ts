import { describe, expect, it } from 'vitest';
import { ashby } from '../src/core/ats/ashby.js';
import { greenhouse } from '../src/core/ats/greenhouse.js';
import { lever } from '../src/core/ats/lever.js';
import { ParseError } from '../src/core/ats/util.js';
import { fixture } from './helpers.js';

describe('greenhouse parser', () => {
  const jobs = greenhouse.parse(fixture('greenhouse.json'), 'Example Robotics');

  it('normalizes every posting', () => {
    expect(jobs).toHaveLength(6);
    const intern = jobs.find((j) => j.atsJobId === '4001001');
    expect(intern).toMatchObject({
      company: 'Example Robotics',
      title: 'Firmware Engineering Intern (Summer 2027)',
      url: 'https://job-boards.greenhouse.io/examplerobotics/jobs/4001001',
      departments: ['Engineering'],
    });
    expect(intern?.location).toContain('Toronto, Ontario, Canada');
    expect(intern?.postedAt).toBe('2026-09-24T13:00:00.000Z');
    expect(intern?.description).toContain("Join Example Robotics' embedded team.");
    expect(intern?.description).toContain('C++ and Python');
  });

  it('falls back to updated_at when first_published is missing', () => {
    expect(jobs.find((j) => j.atsJobId === '4001002')?.postedAt).toBe('2026-09-20T14:00:00.000Z');
  });

  it('flags remote from the location', () => {
    expect(jobs.find((j) => j.atsJobId === '4001004')?.remote).toBe(true);
  });

  it('rejects the wrong shape loudly', () => {
    expect(() => greenhouse.parse([], 'x')).toThrow(ParseError);
    expect(greenhouse.looksLikeBoard({ jobs: [] })).toBe(true);
    expect(greenhouse.looksLikeBoard({ error: 'not found' })).toBe(false);
  });
});

describe('lever parser', () => {
  const jobs = lever.parse(fixture('lever.json'), 'Example Lever Co');

  it('combines description, lists and additional sections', () => {
    const coop = jobs.find((j) => j.title === 'Embedded Software Developer');
    expect(coop?.description).toContain('Four-month co-op');
    expect(coop?.description).toContain("What you'll need");
    expect(coop?.description).toContain('C or C++');
    expect(coop?.description).toContain('all backgrounds');
  });

  it('keeps every location, the commitment and the epoch-ms date', () => {
    const coop = jobs.find((j) => j.title === 'Embedded Software Developer');
    expect(coop?.location).toBe('Waterloo, ON / Toronto, ON');
    expect(coop?.employmentType).toBe('Co-op');
    expect(coop?.postedAt).toBe(new Date(1790000000000).toISOString());
  });

  it('reads workplaceType remote', () => {
    expect(jobs.find((j) => j.title === 'Data Analyst')?.remote).toBe(true);
  });

  it('rejects the wrong shape', () => {
    expect(() => lever.parse({ jobs: [] }, 'x')).toThrow(ParseError);
  });
});

describe('ashby parser', () => {
  const jobs = ashby.parse(fixture('ashby.json'), 'Example Ashby');

  it('skips unlisted postings', () => {
    expect(jobs.map((j) => j.title)).not.toContain('Hidden Intern Role');
    expect(jobs).toHaveLength(2);
  });

  it('adds the structured address and secondary locations', () => {
    const intern = jobs.find((j) => j.title === 'Robotics Research Intern');
    expect(intern?.location).toContain('Toronto, Ontario, Canada');
    expect(intern?.location).toContain('Montreal');
    expect(intern?.employmentType).toBe('Intern');
  });

  it('falls back to HTML when there is no plain description', () => {
    expect(jobs.find((j) => j.title === 'Software Engineer')?.description).toBe('Backend & infra.');
  });
});
