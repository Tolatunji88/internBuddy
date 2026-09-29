/** Job boards we can fetch today. Others are recorded in the registry as `unsupported`. */
export type Ats = 'greenhouse' | 'lever' | 'ashby';

export type CompanyStatus =
  | 'active' // token confirmed; fetched by every scout run
  | 'unresolved' // no token yet; `discover` will try to find one
  | 'needs_review' // a board exists under a guessed slug, but nothing proves it's this company
  | 'unsupported' // uses an ATS we can't fetch yet (Workday, SmartRecruiters, ...)
  | 'disabled'; // failed repeatedly; skipped until re-enabled

/** The one shape every ATS adapter returns. */
export interface NormalizedJob {
  atsJobId: string;
  company: string;
  title: string;
  location: string;
  url: string;
  description: string;
  postedAt: string | null;
  departments: string[];
  employmentType: string | null;
  remote: boolean | null;
}

export interface Company {
  id: number;
  name: string;
  domain: string | null;
  ats: string | null;
  atsToken: string | null;
  careersUrl: string | null;
  hqCity: string | null;
  status: CompanyStatus;
  source: string | null;
  lastOkAt: string | null;
  failCount: number;
  lastError: string | null;
  etag: string | null;
  lastModified: string | null;
}

export type TrackState = 'saved' | 'applied' | 'interviewing' | 'offer' | 'rejected' | 'archived';
export const TRACK_STATES: readonly TrackState[] = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'archived'];

/** What a stored posting is for. Postings that are neither are never stored. */
export type JobKind = 'internship' | 'new_grad';

export interface StoredJob {
  id: number;
  kind: JobKind;
  companyId: number;
  company: string;
  ats: string;
  atsJobId: string;
  title: string;
  location: string;
  url: string;
  description: string;
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  isOpen: boolean;
  remote: boolean | null;
  employmentType: string | null;
  departments: string[];
  seen: boolean;
  state: TrackState | null;
  notes: string | null;
}

export interface School {
  name: string;
  /** LinkedIn school page slug, e.g. linkedin.com/school/<slug>. Enables the alumni-page link. */
  linkedinSlug?: string;
}

export interface Profile {
  name?: string;
  keywords: string[];
  skills: string[];
  roleTypes: string[];
  excludeKeywords: string[];
  locations: string[];
  gradYear?: number;
  schools: School[];
  clubs: string[];
  pastEmployers: string[];
  hometown?: string;
  /** Show full-time new-grad roles too. Off by default: this tool is for student roles. */
  includeNewGrad: boolean;
}
