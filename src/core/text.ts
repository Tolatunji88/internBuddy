const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  hellip: '…', bull: '•', middot: '·', copy: '©', reg: '®', trade: '™',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const code = hex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** HTML job description to readable plain text. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
  let s = html;
  // Greenhouse returns `content` entity-escaped ("&lt;p&gt;"). Unescape once when it looks escaped.
  if (/&lt;\/?[a-z!]/i.test(s) && !/<\/?[a-z!]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol|tr|section|article)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Lowercase and strip accents, for matching. */
export function norm(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-term matcher that works for terms like "c++", "c#" and ".net", where `\b` fails
 * because the term starts or ends with punctuation.
 */
export function termRegex(term: string): RegExp {
  return new RegExp(`(?<![a-z0-9])${escapeRegex(norm(term.trim()))}(?![a-z0-9])`, 'i');
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export function uniq<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

/** Company name → comparable key: "Geotab Inc." and "geotab" match. */
export function companyKey(name: string): string {
  return norm(name)
    .replace(/&/g, 'and')
    .replace(/\b(inc|incorporated|ltd|limited|llc|corp|corporation|co|company|technologies|technology|labs|canada)\b\.?/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}
