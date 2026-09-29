import { ago, dateStamp } from './format.js';
import type { RankedJob } from './match/rank.js';
import { connectionLinks, topLinks } from './network/linkedin.js';
import type { ScoutReport } from './scout.js';
import type { Profile } from './types.js';

/** The daily digest: the postings this run found for the first time, ranked, with who to talk to. */
export function renderDigest(report: ScoutReport, ranked: RankedJob[], profile: Profile, now: Date = new Date()): string {
  const lines: string[] = [];
  lines.push(`# internBuddy — ${dateStamp(now)}`, '');
  lines.push(
    `Checked **${report.boards}** boards (${report.ok} updated, ${report.unchanged} unchanged, ${report.failed.length} failed). ` +
      `Found **${ranked.length}** new student role${ranked.length === 1 ? '' : 's'} that match your profile.`,
    '',
  );

  if (!ranked.length) {
    lines.push('Nothing new today that fits your profile and locations.', '');
  }
  for (const r of ranked) {
    const j = r.job;
    lines.push(`## ${j.title} — ${j.company}`);
    lines.push(`${j.location || 'Location not listed'} · posted ${ago(j.postedAt, now)} · score ${r.score} · #${j.id}`, '');
    if (r.reasons.length) lines.push(`**Why:** ${r.reasons.join('; ')}.`, '');
    if (j.url) lines.push(`**Apply:** ${j.url}`, '');
    const links = topLinks(connectionLinks(j, profile));
    if (links.length) {
      lines.push('**People to talk to:**');
      for (const l of links) lines.push(`- [${l.label}](${l.url})`);
      lines.push('');
    }
  }

  if (report.failed.length) {
    lines.push('---', '', `### ${report.failed.length} board${report.failed.length === 1 ? '' : 's'} failed`, '');
    for (const f of report.failed.slice(0, 50)) lines.push(`- ${f.company}: ${f.error}`);
    if (report.disabled.length) {
      lines.push('', `Disabled after repeated failures: ${report.disabled.join(', ')}. Re-enable with \`internbuddy enable <name>\`.`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
