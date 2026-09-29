import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { alumniPageUrl, connectionLinks, peopleSearchUrl, topLinks } from '../src/core/network/linkedin.js';
import { baseRole, targetsFor } from '../src/core/network/titles.js';
import type { Profile } from '../src/core/types.js';

describe('baseRole', () => {
  it.each([
    ['Software Engineering Intern (Summer 2027)', 'Software Engineer'],
    ['Intern - Software Engineer - AI/ML', 'Software Engineer'],
    ['AI/ML Software Engineer Intern - Data Platform', 'AI/ML Software Engineer'],
    ['National Security Solutions – Software Engineering Intern - Nss', 'Software Engineer'],
    ['Firmware Developer, Fall 2026 (4 months)', 'Firmware Developer'],
    ['Machine Learning Research Intern', 'Machine Learning Researcher'],
    ['Applied AI & Analytics Co-op', 'Applied AI & Analytics'],
    ['Summer Intern 2027', ''],
  ])('%s → %s', (title, role) => {
    expect(baseRole(title)).toBe(role);
  });
});

describe('targetsFor', () => {
  it('suggests the role, the likely manager, past interns and the recruiter', () => {
    expect(targetsFor('Firmware Engineering Intern').map((t) => t.title)).toEqual([
      'Firmware Engineer',
      'Engineering Manager',
      'Intern',
      'University Recruiter',
    ]);
  });

  it('skips the same-role search when the title names no role', () => {
    expect(targetsFor('Summer Intern 2027').map((t) => t.title)).toEqual(['Hiring Manager', 'Intern', 'University Recruiter']);
  });
});

describe('connectionLinks', () => {
  const profile: Profile = {
    keywords: [], skills: [], roleTypes: [], excludeKeywords: [], locations: [], includeNewGrad: false,
    schools: [{ name: 'University of Toronto', linkedinSlug: 'university-of-toronto' }, { name: 'Lawrenceville School' }],
    clubs: ['UTAT'], pastEmployers: ['Geotab'], hometown: 'Toronto',
  };
  const links = connectionLinks({ company: 'Kepler', title: 'Firmware Engineering Intern' }, profile);

  it('puts shared-background links first', () => {
    expect(links.map((l) => l.kind)).toEqual(['alumni', 'school', 'club', 'employer', 'role', 'role', 'role', 'role', 'hometown']);
    expect(topLinks(links).map((l) => l.kind)).toEqual(['alumni', 'school', 'club']);
  });

  it('builds LinkedIn search URLs with quoted, encoded keywords', () => {
    expect(links[0]?.url).toBe(alumniPageUrl('university-of-toronto', 'Kepler'));
    expect(links[0]?.url).toBe('https://www.linkedin.com/school/university-of-toronto/people/?keywords=Kepler');
    expect(links[1]?.url).toBe(peopleSearchUrl('"Kepler" "Lawrenceville School"'));
    expect(decodeURIComponent(links[1]?.url ?? '')).toContain('keywords="Kepler" "Lawrenceville School"');
  });

  it('does not suggest ex-colleagues at the company you worked for', () => {
    const own = connectionLinks({ company: 'Geotab', title: 'Intern' }, profile);
    expect(own.some((l) => l.kind === 'employer')).toBe(false);
  });
});

describe('the LinkedIn rule', () => {
  it('nothing in src/ makes a request to LinkedIn', () => {
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) {
          for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
            if (/linkedin\.com/i.test(line) && /\b(fetch|get|request|http)\s*\(/i.test(line)) offenders.push(`${p}: ${line.trim()}`);
          }
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });

  it('the networking module never touches the network', () => {
    const dir = fileURLToPath(new URL('../src/core/network', import.meta.url));
    for (const f of fs.readdirSync(dir)) {
      const code = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(code, f).not.toMatch(/\bfetch\s*\(|HttpClient|from ['"]node:(http|https|net)['"]/);
    }
  });
});
