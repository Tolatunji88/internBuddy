import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../src/core/paths.js';
import { initProfile, loadProfile, ProfileError, updateProfile } from '../src/core/profile.js';
import { tempHome } from './helpers.js';

const EXAMPLE = path.join(PACKAGE_ROOT, 'config', 'profile.example.yaml');

describe('profile', () => {
  it('uses sensible defaults when there is no file', () => {
    const { profile, exists } = loadProfile(path.join(tempHome(), 'profile.yaml'));
    expect(exists).toBe(false);
    expect(profile).toMatchObject({ locations: ['gta', 'ontario', 'remote-canada'], includeNewGrad: false, keywords: [] });
  });

  it('loads the shipped example cleanly', () => {
    const home = tempHome();
    const file = path.join(home, 'profile.yaml');
    expect(initProfile(file, EXAMPLE)).toBe(true);
    expect(initProfile(file, EXAMPLE)).toBe(false); // never overwrites
    const { profile } = loadProfile(file);
    expect(profile.schools).toEqual([{ name: 'University of Toronto' }]);
    expect(profile.includeNewGrad).toBe(false);
    expect(profile.clubs).toEqual([]);
  });

  it('accepts forgiving YAML: nulls, single strings, string years', () => {
    const file = path.join(tempHome(), 'profile.yaml');
    fs.writeFileSync(file, 'keywords: robotics\nclubs:\ngrad_year: "2028"\nschools: [{ name: Example U, linkedin: example-university }]\n');
    expect(loadProfile(file).profile).toMatchObject({
      keywords: ['robotics'], clubs: [], gradYear: 2028,
      schools: [{ name: 'Example U', linkedinSlug: 'example-university' }],
    });
  });

  it('explains invalid values', () => {
    const file = path.join(tempHome(), 'profile.yaml');
    fs.writeFileSync(file, 'grad_year: soon\n');
    expect(() => loadProfile(file)).toThrow(ProfileError);
    expect(() => loadProfile(file)).toThrow(/grad_year/);
  });

  it('updates fields while keeping the comments a person wrote', () => {
    const file = path.join(tempHome(), 'profile.yaml');
    initProfile(file, EXAMPLE);
    const updated = updateProfile(file, { keywords: ['satellites', 'rf'], clubs: ['Example Robotics Club'], hometown: null });
    expect(updated.keywords).toEqual(['satellites', 'rf']);
    expect(updated.clubs).toEqual(['Example Robotics Club']);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('# Words that make a posting a good fit.');
    expect(text).toContain('- satellites');
    expect(text).not.toMatch(/^hometown:/m);
  });

  it('creates the file from the template on first update, and rejects unknown fields', () => {
    const file = path.join(tempHome(), 'nested', 'profile.yaml');
    updateProfile(file, { name: 'Sam' }, EXAMPLE);
    expect(loadProfile(file).profile.name).toBe('Sam');
    expect(fs.readFileSync(file, 'utf8')).toContain('# internBuddy profile');
    expect(() => updateProfile(file, { nope: 1 } as never)).toThrow(/Unknown profile field/);
  });
});
