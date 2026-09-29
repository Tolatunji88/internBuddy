import { describe, expect, it } from 'vitest';
import { classifyRole } from '../src/core/match/classify.js';

describe('classifyRole: student roles only', () => {
  it.each([
    'Software Engineering Intern (Summer 2027)',
    'Software Developer, Fall 2026 (4 months)',
    'Hardware Co-op, 8-16 months',
    'PEY Co-op - Firmware',
    'Campus Recruiting Intern',
    'Talent Acquisition Intern',
    'Program Manager - Co-op',
    'Product Manager Intern',
    'Summer Analyst',
    'Summer Student - Electrical',
    'Undergraduate Research Assistant',
    'Graduate Research Assistant',
    'Stagiaire en développement logiciel',
    'Interns - Software (Summer 2027)',
    'Data Analyst - 8 Months',
  ])('%s → internship', (title) => {
    expect(classifyRole(title)).toBe('internship');
  });

  it.each([
    // Staff jobs about interns
    'Internship Program Manager',
    'Co-op & Internship Coordinator',
    'University Recruiter',
    'Recruiter, Interns & New Grads',
    'Engineering Manager, Intern Program',
    // Jobs serving students
    'Student Success Manager',
    'Student Experience Specialist',
    // Word-boundary traps
    'Internal Tools Engineer',
    'International Sales Representative',
    // Ordinary full-time jobs
    'Senior Software Engineer',
    'Junior Data Analyst',
    'Business Analyst - 12-Month Contract',
    'Graduate Research Scientist - PhD',
    'Software Developer Rotation Program - Summer 2027',
  ])('%s → other', (title) => {
    expect(classifyRole(title)).toBe('other');
  });

  it.each([
    'Software Engineer, New Grad (2027)',
    'Electrical Engineer New Grad - Summer 2027',
    'Software Engineer - Early Career - Fall 2026',
    'Entry Level Data Analyst',
  ])('%s → new_grad (hidden unless opted in)', (title) => {
    expect(classifyRole(title)).toBe('new_grad');
  });

  it('trusts the board’s employment type when the title is vague', () => {
    expect(classifyRole('Firmware Engineering', 'Intern')).toBe('internship');
    expect(classifyRole('Embedded Software Developer', 'Co-op')).toBe('internship');
    expect(classifyRole('Firmware Engineering', 'Full-time')).toBe('other');
  });

  it('never lets a recruiter through, even with a student employment type', () => {
    expect(classifyRole('University Recruiter', 'Intern')).toBe('other');
  });
});
