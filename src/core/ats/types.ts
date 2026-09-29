import type { Ats, NormalizedJob } from '../types.js';

export interface AtsAdapter {
  ats: Ats;
  /** Public JSON endpoint for a board. */
  boardApiUrl(token: string): string;
  /** Lightest request that proves a board exists (used by discovery, not for ingesting). */
  probeUrl(token: string): string;
  /** Human-facing board URL, for display. */
  boardPublicUrl(token: string): string;
  /** Cheap shape check used by discovery to confirm a token points at a real board. */
  looksLikeBoard(raw: unknown): boolean;
  /** Pure: raw API response in, normalized jobs out. Throws ParseError on an unexpected shape. */
  parse(raw: unknown, company: string): NormalizedJob[];
}
