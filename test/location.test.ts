import { describe, expect, it } from 'vitest';
import { matchLocation } from '../src/core/match/location.js';

const DEFAULT = ['gta', 'ontario', 'remote-canada'];

describe('matchLocation', () => {
  it.each([
    ['Toronto', 'GTA'],
    ['Toronto, ON, CA', 'GTA'],
    ['Mississauga, Ontario, Canada', 'GTA'],
    ['New York, NY / Toronto, Ontario', 'GTA'],
    ['Burlington, ON', 'GTA'],
    ['Waterloo, ON', 'Ontario'],
    ['Cambridge, ON, Canada', 'Ontario'],
    ['Ottawa', 'Ontario'],
    ['Remote - Canada', 'Remote (Canada)'],
    ['Remote in Canada', 'Remote (Canada)'],
    ['Remote - North America', 'Remote (Canada)'],
  ])('%s matches the defaults as %s', (loc, label) => {
    expect(matchLocation(loc, null, DEFAULT)).toBe(label);
  });

  it.each([
    'Burlington, MA',
    'Aurora, CO',
    'Cambridge, MA',
    'Cambridge, UK',
    'Milton Keynes, UK',
    'London, UK',
    'Markham, IL',
    'Waterloo, IA',
    'Vancouver, WA',
    'San Francisco, CA',
    'Remote - US',
    'Remote',
    '',
  ])('%s does not match the defaults', (loc) => {
    expect(matchLocation(loc, null, DEFAULT)).toBeNull();
  });

  it('uses the job’s remote flag', () => {
    expect(matchLocation('Canada', true, ['remote-canada'])).toBe('Remote (Canada)');
    expect(matchLocation('Canada', null, ['remote-canada'])).toBeNull();
  });

  it('supports canada, remote, any and free-text places', () => {
    expect(matchLocation('Vancouver, BC', null, ['canada'])).toBe('Canada');
    expect(matchLocation('La Cañada Flintridge, CA', null, ['canada'])).toBeNull();
    expect(matchLocation('Remote - US', null, ['remote'])).toBe('Remote');
    expect(matchLocation('Berlin', null, ['any'])).toBe('Any location');
    expect(matchLocation('New York, NY', null, ['new york'])).toBe('new york');
  });

  it('returns the first preference that matches, in profile order', () => {
    expect(matchLocation('Toronto, ON', null, ['ontario', 'gta'])).toBe('Ontario');
  });
});
