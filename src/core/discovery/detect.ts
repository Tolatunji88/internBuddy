/** Find job-board references (ATS + token) in any text: a URL, a careers page, a README. */
export interface BoardRef {
  ats: string;
  token: string;
  /** For boards we can't fetch yet, where they live — so a future adapter has a head start. */
  careersUrl: string | null;
}

interface Pattern {
  ats: string;
  re: RegExp;
  careers?: (m: RegExpMatchArray) => string;
}

// Order matters: the specific Greenhouse forms come before the generic one.
const PATTERNS: Pattern[] = [
  { ats: 'greenhouse', re: /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/g },
  { ats: 'greenhouse', re: /(?:job-)?boards\.greenhouse\.io\/embed\/job_(?:board|app)(?:\/js)?\?[^"'\s<>]*?\bfor=([A-Za-z0-9_-]+)/g },
  { ats: 'greenhouse', re: /(?:job-)?boards\.greenhouse\.io\/(?!embed\b)([A-Za-z0-9_-]+)/g },
  { ats: 'lever', re: /(?<!eu\.)jobs\.lever\.co\/([A-Za-z0-9._-]+)/g },
  { ats: 'ashby', re: /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9._%-]+)/g },
  { ats: 'ashby', re: /jobs\.ashbyhq\.com\/([A-Za-z0-9._%-]+)/g },
  {
    ats: 'workday',
    re: /https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/g,
    careers: (m) => `https://${m[1]}.${m[2]}.myworkdayjobs.com/${m[3]}`,
  },
  { ats: 'smartrecruiters', re: /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/g },
  { ats: 'workable', re: /apply\.workable\.com\/(?!j\/)([A-Za-z0-9_-]+)/g },
];

/** Path segments that look like tokens but aren't. */
const NOT_TOKENS = new Set(['embed', 'api', 'v1', 'jobs', 'j', 'job', 'careers', 'static', 'assets', 'favicon.ico']);

function decodeToken(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function detectBoards(text: string): BoardRef[] {
  const found = new Map<string, BoardRef>();
  for (const p of PATTERNS) {
    for (const m of text.matchAll(p.re)) {
      const token = decodeToken(m[1] ?? '').replace(/\.+$/, '');
      if (!token || NOT_TOKENS.has(token.toLowerCase())) continue;
      const key = `${p.ats}:${token.toLowerCase()}`;
      if (!found.has(key)) found.set(key, { ats: p.ats, token, careersUrl: p.careers ? p.careers(m) : null });
    }
  }
  return [...found.values()];
}
