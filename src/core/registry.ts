import crypto from 'node:crypto';
import fs from 'node:fs';
import { isSupportedAts } from './ats/index.js';
import { type DB, getSetting, setSetting, tx } from './db.js';
import { findCompanyByBoard, insertCompany, listCompanies, updateCompany } from './store.js';
import { companyKey } from './text.js';
import type { Company, CompanyStatus } from './types.js';

/**
 * data/companies.csv is the shared, committed list of companies. The database is each person's
 * local copy, which grows with `discover`. Sync only ever adds or fills blanks, so local state
 * (a board you disabled, a token you confirmed) is never overwritten by the shipped list.
 */
export const REGISTRY_COLUMNS = ['name', 'ats', 'ats_token', 'domain', 'careers_url', 'hq_city', 'status', 'source'] as const;
export type RegistryRow = Record<(typeof REGISTRY_COLUMNS)[number], string>;

const STATUSES: CompanyStatus[] = ['active', 'unresolved', 'needs_review', 'unsupported', 'disabled'];

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function readRegistry(file: string): RegistryRow[] {
  if (!fs.existsSync(file)) return [];
  const [header, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!header) return [];
  const idx = header.map((h) => h.trim().toLowerCase());
  return rows
    .map((cells) => {
      const r = Object.fromEntries(REGISTRY_COLUMNS.map((c) => [c, ''])) as RegistryRow;
      idx.forEach((col, i) => {
        if ((REGISTRY_COLUMNS as readonly string[]).includes(col)) r[col as keyof RegistryRow] = (cells[i] ?? '').trim();
      });
      return r;
    })
    .filter((r) => r.name);
}

export function writeRegistry(file: string, rows: RegistryRow[]): void {
  const lines = [REGISTRY_COLUMNS.join(','), ...rows.map((r) => REGISTRY_COLUMNS.map((c) => csvCell(r[c] ?? '')).join(','))];
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
}

function statusFor(r: RegistryRow): CompanyStatus {
  if ((STATUSES as string[]).includes(r.status)) return r.status as CompanyStatus;
  if (!r.ats_token) return 'unresolved';
  return isSupportedAts(r.ats) ? 'active' : 'unsupported';
}

const nz = (s: string) => (s ? s : null);

export interface SyncResult {
  added: number;
  upgraded: number;
}

export function syncRegistry(db: DB, rows: RegistryRow[]): SyncResult {
  const companies = listCompanies(db);
  const byKey = new Map<string, Company[]>();
  for (const c of companies) {
    const k = companyKey(c.name);
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }
  const fillBlanks = (c: Company, r: RegistryRow) => {
    const patch: Partial<Company> = {};
    if (!c.domain && r.domain) patch.domain = r.domain;
    if (!c.careersUrl && r.careers_url) patch.careersUrl = r.careers_url;
    if (!c.hqCity && r.hq_city) patch.hqCity = r.hq_city;
    updateCompany(db, c.id, patch);
  };

  let added = 0;
  let upgraded = 0;
  tx(db, () => {
    for (const r of rows) {
      const key = companyKey(r.name);
      if (r.ats && r.ats_token) {
        const existing = findCompanyByBoard(db, r.ats, r.ats_token);
        if (existing) {
          fillBlanks(existing, r);
          continue;
        }
        const unresolved = byKey.get(key)?.find((c) => !c.atsToken && c.status === 'unresolved');
        if (unresolved) {
          updateCompany(db, unresolved.id, {
            ats: r.ats, atsToken: r.ats_token, status: statusFor(r), source: nz(r.source),
          });
          fillBlanks(unresolved, r);
          unresolved.atsToken = r.ats_token;
          upgraded++;
          continue;
        }
      } else if (byKey.has(key)) {
        for (const c of byKey.get(key) ?? []) fillBlanks(c, r);
        continue;
      }
      insertCompany(db, {
        name: r.name, ats: nz(r.ats), atsToken: nz(r.ats_token), domain: nz(r.domain),
        careersUrl: nz(r.careers_url), hqCity: nz(r.hq_city), status: statusFor(r), source: nz(r.source),
      });
      added++;
    }
  });
  return { added, upgraded };
}

/** Sync the shipped CSV into the database, but only when the file changed since last time. */
export function syncRegistryFile(db: DB, file: string): SyncResult | null {
  if (!fs.existsSync(file)) return null;
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (getSetting(db, 'registry_hash') === hash) return null;
  const result = syncRegistry(db, readRegistry(file));
  setSetting(db, 'registry_hash', hash);
  return result;
}

/**
 * The shareable subset of the local registry, for committing back to data/companies.csv so
 * friends start with everything you've discovered. Disabled boards and unconfirmed guesses
 * stay local.
 */
export function exportRegistry(db: DB): RegistryRow[] {
  const order: Record<string, number> = { active: 0, unsupported: 1, unresolved: 2 };
  return listCompanies(db, ['active', 'unsupported', 'unresolved'])
    .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.name.localeCompare(b.name))
    .map((c) => ({
      name: c.name,
      ats: c.ats ?? '',
      ats_token: c.atsToken ?? '',
      domain: c.domain ?? '',
      careers_url: c.careersUrl ?? '',
      hq_city: c.hqCity ?? '',
      status: c.status,
      source: c.source ?? '',
    }));
}
