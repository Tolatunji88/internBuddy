import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { DEFAULT_LOCATIONS } from './match/location.js';
import type { Profile } from './types.js';

const text = z.string().trim().min(1);

/** YAML is forgiving: accept `key:` (null) and `key: one-value` for list fields. */
function list(defaults: string[] = []) {
  return z.preprocess(
    (v) => (v == null ? undefined : typeof v === 'string' ? [v] : v),
    z.array(text).default(defaults),
  );
}

const school = z.union([
  text,
  z.object({ name: text, linkedin: z.string().trim().min(1).optional() }),
]);

/** The profile file as the user writes it (snake_case). */
export const ProfileFileSchema = z.object({
  name: z.preprocess((v) => (v == null ? undefined : v), z.string().trim().optional()),
  keywords: list(),
  skills: list(),
  role_types: list(),
  exclude_keywords: list(),
  locations: list(DEFAULT_LOCATIONS),
  grad_year: z.preprocess(
    (v) => (v == null || v === '' ? undefined : typeof v === 'string' ? Number(v) : v),
    z.number().int().min(1990).max(2100).optional(),
  ),
  include_new_grad: z.preprocess((v) => (v == null ? undefined : v), z.boolean().default(false)),
  schools: z.preprocess(
    (v) => (v == null ? undefined : typeof v === 'string' ? [v] : v),
    z.array(school).default([]),
  ),
  clubs: list(),
  past_employers: list(),
  hometown: z.preprocess((v) => (v == null ? undefined : v), z.string().trim().optional()),
});

export type ProfileFile = z.output<typeof ProfileFileSchema>;
export type ProfilePatch = Partial<z.input<typeof ProfileFileSchema>>;
export const PROFILE_KEYS = Object.keys(ProfileFileSchema.shape) as (keyof ProfileFile)[];

export class ProfileError extends Error {
  override name = 'ProfileError';
}

function toProfile(f: ProfileFile): Profile {
  return {
    name: f.name || undefined,
    keywords: f.keywords,
    skills: f.skills,
    roleTypes: f.role_types,
    excludeKeywords: f.exclude_keywords,
    locations: f.locations,
    gradYear: f.grad_year,
    includeNewGrad: f.include_new_grad,
    schools: f.schools.map((s) => (typeof s === 'string' ? { name: s } : { name: s.name, linkedinSlug: s.linkedin })),
    clubs: f.clubs,
    pastEmployers: f.past_employers,
    hometown: f.hometown || undefined,
  };
}

function parseFile(raw: unknown, where: string): ProfileFile {
  const result = ProfileFileSchema.safeParse(raw ?? {});
  if (!result.success) throw new ProfileError(`Problem in ${where}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

export interface LoadedProfile {
  profile: Profile;
  exists: boolean;
  path: string;
}

export function loadProfile(file: string): LoadedProfile {
  if (!fs.existsSync(file)) return { profile: toProfile(parseFile({}, file)), exists: false, path: file };
  let raw: unknown;
  try {
    raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ProfileError(`${file} is not valid YAML: ${(err as Error).message}`);
  }
  return { profile: toProfile(parseFile(raw, file)), exists: true, path: file };
}

/**
 * Apply a partial update and write it back. Edits go through YAML's document model so the
 * comments and ordering a person wrote by hand survive an agent changing one field.
 * A key set to null is removed (falls back to its default).
 */
export function updateProfile(file: string, patch: ProfilePatch, templateFile?: string): Profile {
  const source = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8')
    : templateFile && fs.existsSync(templateFile)
      ? fs.readFileSync(templateFile, 'utf8')
      : '';
  const parsed = YAML.parseDocument(source);
  if (parsed.errors.length) throw new ProfileError(`${file} is not valid YAML: ${parsed.errors[0]?.message}`);
  // An empty or non-map file (e.g. only comments) starts from a fresh mapping.
  const doc: YAML.Document = YAML.isMap(parsed.contents) ? parsed : new YAML.Document({});

  for (const [key, value] of Object.entries(patch)) {
    if (!PROFILE_KEYS.includes(key as keyof ProfileFile)) throw new ProfileError(`Unknown profile field "${key}".`);
    if (value === undefined) continue;
    if (value === null) doc.delete(key);
    else doc.set(key, value);
  }
  const result = parseFile(doc.toJS(), 'the updated profile');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, doc.toString(), 'utf8');
  return toProfile(result);
}

/** Copy the example profile into place if there isn't one yet. Returns true if it created it. */
export function initProfile(file: string, templateFile: string): boolean {
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(templateFile, file);
  return true;
}

/** Profile as the user-facing snake_case shape, for display and agents. */
export function profileToFile(p: Profile): ProfileFile {
  return {
    name: p.name,
    keywords: p.keywords,
    skills: p.skills,
    role_types: p.roleTypes,
    exclude_keywords: p.excludeKeywords,
    locations: p.locations,
    grad_year: p.gradYear,
    include_new_grad: p.includeNewGrad,
    schools: p.schools.map((s) => (s.linkedinSlug ? { name: s.name, linkedin: s.linkedinSlug } : s.name)),
    clubs: p.clubs,
    past_employers: p.pastEmployers,
    hometown: p.hometown,
  };
}

export function isProfileEmpty(p: Profile): boolean {
  return !p.keywords.length && !p.skills.length && !p.roleTypes.length;
}
