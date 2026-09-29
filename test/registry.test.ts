import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportRegistry, parseCsv, readRegistry, syncRegistry, syncRegistryFile, writeRegistry } from '../src/core/registry.js';
import { findCompanyByBoard, insertCompany, listCompanies, updateCompany } from '../src/core/store.js';
import { PACKAGE_ROOT } from '../src/core/paths.js';
import { tempHome, testCtx } from './helpers.js';

const row = (o: Partial<Record<string, string>>) => ({
  name: '', ats: '', ats_token: '', domain: '', careers_url: '', hq_city: '', status: '', source: '', ...o,
});

describe('CSV', () => {
  it('round-trips quotes, commas and newlines', () => {
    const file = path.join(tempHome(), 'r.csv');
    const rows = [row({ name: 'A, "Quoted" Co', domain: 'a.com', hq_city: 'Line\nBreak' }), row({ name: 'B' })];
    writeRegistry(file, rows);
    expect(readRegistry(file)).toEqual(rows);
    expect(parseCsv('a,b\r\n"x,y",z\n')).toEqual([['a', 'b'], ['x,y', 'z']]);
  });
});

describe('syncRegistry', () => {
  it('adds, upgrades name-only companies, and never overwrites local state', () => {
    const ctx = testCtx();
    const known = insertCompany(ctx.db, { name: 'Geotab Inc.' });
    const local = insertCompany(ctx.db, { name: 'Kepler', ats: 'lever', atsToken: 'kepler' });
    updateCompany(ctx.db, local, { status: 'disabled' });

    const r = syncRegistry(ctx.db, [
      row({ name: 'Geotab', ats: 'greenhouse', ats_token: 'geotab', domain: 'geotab.com' }),
      row({ name: 'Kepler Communications', ats: 'lever', ats_token: 'kepler', status: 'active', domain: 'kepler.space' }),
      row({ name: 'RBC', ats: 'workday', ats_token: 'rbc' }),
      row({ name: 'Unknown Startup' }),
    ]);
    expect(r).toEqual({ added: 2, upgraded: 1 });
    expect(findCompanyByBoard(ctx.db, 'greenhouse', 'geotab')).toMatchObject({ id: known, status: 'active', domain: 'geotab.com' });
    // Local "disabled" survives; blank fields get filled.
    expect(findCompanyByBoard(ctx.db, 'lever', 'kepler')).toMatchObject({ status: 'disabled', domain: 'kepler.space' });
    expect(findCompanyByBoard(ctx.db, 'workday', 'rbc')?.status).toBe('unsupported');
    expect(listCompanies(ctx.db, ['unresolved']).map((c) => c.name)).toEqual(['Unknown Startup']);
  });

  it('only re-syncs the file when it changes', () => {
    const ctx = testCtx();
    const file = path.join(ctx.home, 'companies.csv');
    writeRegistry(file, [row({ name: 'A' })]);
    expect(syncRegistryFile(ctx.db, file)).toEqual({ added: 1, upgraded: 0 });
    expect(syncRegistryFile(ctx.db, file)).toBeNull();
    writeRegistry(file, [row({ name: 'A' }), row({ name: 'B' })]);
    expect(syncRegistryFile(ctx.db, file)).toEqual({ added: 1, upgraded: 0 });
  });

  it('exports what is worth sharing: not disabled boards or unconfirmed guesses', () => {
    const ctx = testCtx();
    insertCompany(ctx.db, { name: 'Good', ats: 'greenhouse', atsToken: 'good' });
    insertCompany(ctx.db, { name: 'Dead', ats: 'greenhouse', atsToken: 'dead', status: 'disabled' });
    insertCompany(ctx.db, { name: 'Guess', ats: 'lever', atsToken: 'guess', status: 'needs_review' });
    insertCompany(ctx.db, { name: 'Bank', ats: 'workday', atsToken: 'bank', status: 'unsupported' });
    expect(exportRegistry(ctx.db).map((r) => `${r.name}:${r.status}`)).toEqual(['Good:active', 'Bank:unsupported']);
  });
});

describe('the shipped registry', () => {
  const rows = readRegistry(path.join(PACKAGE_ROOT, 'data', 'companies.csv'));

  it('is well-formed', () => {
    expect(rows.length).toBeGreaterThan(300);
    for (const r of rows) {
      expect(['active', 'unsupported', 'unresolved']).toContain(r.status);
      if (r.status === 'unresolved') expect(r.ats_token).toBe('');
      else expect(r.ats && r.ats_token, r.name).toBeTruthy();
    }
    const boards = rows.filter((r) => r.ats_token).map((r) => `${r.ats}:${r.ats_token.toLowerCase()}`);
    expect(new Set(boards).size).toBe(boards.length);
  });

  it('syncs into a fresh database', () => {
    const ctx = testCtx();
    const r = syncRegistry(ctx.db, rows);
    expect(r.added + r.upgraded).toBe(rows.length);
    expect(fs.existsSync(path.join(PACKAGE_ROOT, 'data', 'companies.csv'))).toBe(true);
  });
});
