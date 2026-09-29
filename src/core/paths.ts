import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root in development, package root when installed. Resolved from this file, never cwd. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface Paths {
  /** Per-user data directory: database, profile, reports. */
  home: string;
  db: string;
  profile: string;
  reports: string;
  /** Shipped company registry. */
  registryCsv: string;
  profileExample: string;
}

/**
 * Everything personal lives in one per-user directory, not the working directory. The MCP
 * server is launched from wherever the user started their agent, so cwd-relative paths would
 * make the CLI and the MCP server silently disagree about which profile and database to use.
 */
export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.INTERNBUDDY_HOME) return path.resolve(env.INTERNBUDDY_HOME);
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'internbuddy');
  if (process.platform === 'win32') {
    return path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'internbuddy');
  }
  return path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'internbuddy');
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = homeDir(env);
  return {
    home,
    db: path.join(home, 'internbuddy.db'),
    profile: env.INTERNBUDDY_PROFILE ? path.resolve(env.INTERNBUDDY_PROFILE) : path.join(home, 'profile.yaml'),
    reports: path.join(home, 'reports'),
    registryCsv: path.join(PACKAGE_ROOT, 'data', 'companies.csv'),
    profileExample: path.join(PACKAGE_ROOT, 'config', 'profile.example.yaml'),
  };
}
