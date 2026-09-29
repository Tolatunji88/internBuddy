import { describe, expect, it } from 'vitest';
import { companyKey, htmlToText, termRegex } from '../src/core/text.js';

describe('htmlToText', () => {
  it('handles Greenhouse’s entity-escaped HTML, including double-escaped apostrophes', () => {
    const text = htmlToText('&lt;p&gt;Join Example&amp;#39;s team.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;C++&lt;/li&gt;&lt;/ul&gt;');
    expect(text).toContain("Join Example's team.");
    expect(text).toContain('• C++');
    expect(text).not.toMatch(/<|&lt;|&amp;/);
  });

  it('handles ordinary HTML and drops scripts', () => {
    expect(htmlToText('<p>A &amp; B</p><script>alert(1)</script><br>C')).toMatch(/^A & B\n+C$/);
  });
});

describe('termRegex', () => {
  it('matches terms with punctuation that \\b would miss', () => {
    expect(termRegex('c++').test('experience with c++ and rust')).toBe(true);
    expect(termRegex('c#').test('C# / .NET')).toBe(true);
    expect(termRegex('ros').test('ROS 2')).toBe(true);
  });

  it('does not match inside words', () => {
    expect(termRegex('ros').test('across the stack')).toBe(false);
    expect(termRegex('go').test('good algorithms')).toBe(false);
  });
});

describe('companyKey', () => {
  it('treats suffixes and punctuation as noise', () => {
    expect(companyKey('Geotab Inc.')).toBe(companyKey('geotab'));
    expect(companyKey('Kepler Communications Ltd')).toBe(companyKey('Kepler Communications'));
  });
});
