import type { Ats } from '../types.js';
import { ashby } from './ashby.js';
import { greenhouse } from './greenhouse.js';
import { lever } from './lever.js';
import type { AtsAdapter } from './types.js';

export const ADAPTERS: Record<Ats, AtsAdapter> = { greenhouse, lever, ashby };
export const SUPPORTED_ATS = Object.keys(ADAPTERS) as Ats[];

export function isSupportedAts(ats: string | null | undefined): ats is Ats {
  return ats != null && Object.hasOwn(ADAPTERS, ats);
}

export type { AtsAdapter } from './types.js';
