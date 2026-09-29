import type { HttpClient } from '../ats/client.js';

/**
 * Minimal robots.txt support for the one kind of non-ATS page we ever read: a company's own
 * careers page. Implements user-agent groups, Allow/Disallow, longest-match wins, and the
 * `*` and `$` wildcards.
 */
export function isAllowedByRobots(robotsTxt: string, urlPath: string, agent = 'internbuddy'): boolean {
  interface Group {
    agents: string[];
    rules: { allow: boolean; pattern: string }[];
  }
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && current) {
      if (value) current.rules.push({ allow: field === 'allow', pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }

  const me = agent.toLowerCase();
  const group =
    groups.find((g) => g.agents.some((a) => a !== '*' && me.includes(a))) ?? groups.find((g) => g.agents.includes('*'));
  if (!group) return true;

  let best: { allow: boolean; length: number } | null = null;
  for (const rule of group.rules) {
    const anchored = rule.pattern.endsWith('$');
    const body = anchored ? rule.pattern.slice(0, -1) : rule.pattern;
    const re = new RegExp(`^${body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
    if (!re.test(urlPath)) continue;
    // Longest pattern wins; on a tie, Allow wins.
    if (!best || rule.pattern.length > best.length || (rule.pattern.length === best.length && rule.allow)) {
      best = { allow: rule.allow, length: rule.pattern.length };
    }
  }
  return best ? best.allow : true;
}

export class RobotsCache {
  private readonly cache = new Map<string, Promise<string | null>>();
  constructor(private readonly http: HttpClient) {}

  async allows(url: string): Promise<boolean> {
    const u = new URL(url);
    let pending = this.cache.get(u.origin);
    if (!pending) {
      pending = this.http.get(`${u.origin}/robots.txt`, { as: 'text' }).then((r) => (r.ok ? String(r.body) : null));
      this.cache.set(u.origin, pending);
    }
    const txt = await pending;
    // No robots.txt (404) means everything is allowed.
    return txt === null ? true : isAllowedByRobots(txt, `${u.pathname}${u.search}`);
  }
}
