/**
 * Text views shared by every face, so the CLI, the MCP server and the digest describe a
 * posting the same way. Compact by design: an agent reads these, and every line costs context.
 */
import { ago } from './format.js';
import type { RankedJob } from './match/rank.js';
import type { ConnectionLink } from './network/linkedin.js';
import { truncate } from './text.js';
import type { StoredJob } from './types.js';

export function jobRow(r: RankedJob, now: Date = new Date()): string {
  const j = r.job;
  const flags = [j.kind === 'new_grad' ? 'new grad' : null, j.state ? j.state : null].filter(Boolean);
  const head = `#${j.id} · ${r.score} · ${j.title} — ${j.company}${flags.length ? ` [${flags.join(', ')}]` : ''}`;
  const where = `${truncate(j.location || 'location not listed', 60)} · posted ${ago(j.postedAt, now)}`;
  const why = r.reasons.length ? ` · why: ${truncate(r.reasons.join('; '), 150)}` : '';
  return `${head}\n    ${where}${why}`;
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  nextCursor: string | null;
}

export function paginate<T>(items: T[], cursor: string | undefined, limit: number): Page<T> {
  const offset = Math.max(0, Number.parseInt(cursor ?? '0', 10) || 0);
  const size = Math.max(1, Math.min(limit, 50));
  const slice = items.slice(offset, offset + size);
  const end = offset + slice.length;
  return { items: slice, total: items.length, offset, nextCursor: end < items.length ? String(end) : null };
}

export function pageFooter(p: Page<unknown>): string {
  if (!p.total) return '';
  const range = `Showing ${p.offset + 1}–${p.offset + p.items.length} of ${p.total}.`;
  return p.nextCursor ? `${range} More: cursor="${p.nextCursor}"` : range;
}

export function jobDetail(j: StoredJob, r: RankedJob | null, now: Date = new Date(), maxDescription = 6000): string {
  const lines = [
    `#${j.id} · ${j.title} — ${j.company}`,
    `${j.location || 'Location not listed'}${j.remote ? ' (remote)' : ''} · posted ${ago(j.postedAt, now)} · first seen ${ago(j.firstSeenAt, now)}`,
    `Kind: ${j.kind === 'internship' ? 'internship / co-op / student role' : 'new-grad role'}${j.employmentType ? ` · ${j.employmentType}` : ''}${j.isOpen ? '' : ' · CLOSED (no longer on the board)'}`,
    `Apply: ${j.url || 'no link on the posting'}`,
  ];
  if (j.state) lines.push(`Tracking: ${j.state}${j.notes ? ` — ${j.notes}` : ''}`);
  if (r) lines.push(`Match: score ${r.score}${r.reasons.length ? ` — ${r.reasons.join('; ')}` : ' — no profile terms matched'}`);
  lines.push('', truncate(j.description || '(no description on the posting)', maxDescription));
  return lines.join('\n');
}

export function connectionsView(j: StoredJob, links: ConnectionLink[], profileHasAffinities: boolean): string {
  const lines = [`People worth talking to about #${j.id} ${j.title} — ${j.company}`, ''];
  const affinity = links.filter((l) => l.kind !== 'role');
  const roles = links.filter((l) => l.kind === 'role');
  if (affinity.length) {
    lines.push('Shared background (warmest introductions):');
    for (const l of affinity) lines.push(`- ${l.label}${l.why ? ` — ${l.why}` : ''}\n  ${l.url}`);
    lines.push('');
  }
  if (roles.length) {
    lines.push('Who to look for:');
    for (const l of roles) lines.push(`- ${l.label}${l.why ? ` — ${l.why}` : ''}\n  ${l.url}`);
    lines.push('');
  }
  if (!profileHasAffinities) {
    lines.push('Tip: add schools, clubs and past employers to your profile to get shared-background searches.');
  }
  lines.push('These are LinkedIn searches for you to open. internBuddy never contacts LinkedIn or anyone on it.');
  return lines.join('\n');
}
