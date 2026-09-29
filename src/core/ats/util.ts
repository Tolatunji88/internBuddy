export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

/** Accepts ISO strings and epoch milliseconds (Lever); returns ISO or null. */
export function isoOrNull(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v > 1e12 ? v : v * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function joinLocations(parts: Iterable<string>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if ([...seen].some((s) => s.includes(key))) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(' / ');
}

export class ParseError extends Error {
  override name = 'ParseError';
}
