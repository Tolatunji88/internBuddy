/**
 * Decides whether a posting is a role FOR students. This is the tool's core promise, so it
 * errs toward precision: a full-time job that slips through is worse than a rare internship
 * titled so oddly that we miss it.
 *
 *   internship — internships, co-ops, PEY, work terms, and roles explicitly for students
 *   new_grad   — full-time roles for recent graduates. Stored, but hidden unless the
 *                profile opts in with `include_new_grad: true`.
 *   other      — everything else, including staff jobs *about* interns (recruiters,
 *                program coordinators) and jobs *serving* students (student success).
 */
export type RoleKind = 'internship' | 'new_grad' | 'other';

const STAFF_NOUN =
  'manager|coordinator|recruiter|recruiting|lead|advisor|adviser|specialist|partner|director|administrator|officer|representative';

/** "Intern", "Co-op", "PEY", "Work term", "Stagiaire" as the role itself. */
const STUDENT_ROLE_NOUN = /\b(intern(?:ship)?s?|co-?ops?|co\s+op|pey|work[\s-]?terms?|stagiaire)\b/gi;

/** What follows a role noun that makes it a staff job about interns: "Intern Program Manager". */
const FOLLOWED_BY_STAFF = new RegExp(
  `^\\s*(?:(?:&|and|/|,)\\s*(?:intern(?:ship)?s?|co-?ops?|students?)\\s*)*(?:program(?:me)?s?\\b|(?:${STAFF_NOUN})\\b)`,
  'i',
);

/** Roles that serve students rather than employ them. */
const SERVES_STUDENTS =
  /\bstudents?\s+(success|experience|services?|support|engagement|affairs|enrol?ments?|recruitment|advis\w*|life|care|outreach|marketing|finance|loans?|housing)\b/i;

const STUDENT_ROLE_PHRASE = new RegExp(
  [
    String.raw`\b(summer|co-?op|working|placement|undergraduate|graduate|university|college|part[\s-]time)\s+students?\b`,
    String.raw`\bstudents?\s+(intern|engineer|developer|analyst|researcher|research|assistant|associate|worker|programmer|technician|position|role|trainee|ambassador)\b`,
    String.raw`\bsummer\s+(analyst|associate|engineer|developer|researcher|intern|student|technician|scholar)s?\b`,
    String.raw`^students?\b`,
    // Roles for university students: "Undergraduate Research Assistant", "Graduate Researcher".
    String.raw`\bundergraduate\b`,
    String.raw`\bgraduate\s+(assistant|researcher|research\s+assistant|fellow)s?\b`,
  ].join('|'),
  'i',
);

/** Canadian co-op titles often only say the term or length: "Software Developer, Fall 2026 (4 months)". */
const SEASON_TERM = /\b(summer|fall|autumn|winter|spring)\s*(?:\/\s*(?:summer|fall|autumn|winter|spring)\s*)?(?:20\d\d|term)\b/i;
const DURATION = /\b(?:4|8|12|16)(?:\s*(?:-|–|to)\s*(?:8|12|16))?[\s-]*(?:months?|mos?)\b/i;

const SENIOR = /\b(senior|sr\.?|staff|principal|director|head\s+of|vp|vice\s+president|lead)\b/i;
/** A term or length alone doesn't make a student role when the title says it's one of these. */
const NOT_A_WORK_TERM = /\b(contract|contractor|rotation(?:al)?|full[\s-]?time|permanent|fixed[\s-]?term|consultant)\b/i;
const RECRUITER = /\brecruiters?\b/i;

const NEW_GRAD =
  /\bnew[\s-]*grad(?:uate)?s?\b|\b(?:recent|university|college)\s+grad(?:uate)?s?\b|\bearly[\s-]*career\b|\bgraduate\s+(?:program(?:me)?|engineer|developer|analyst|scheme|rotational|trainee)\b|\bentry[\s-]*level\b|\bclass\s+of\s+20\d\d\b/i;

const STUDENT_EMPLOYMENT_TYPE = /\b(intern(?:ship)?|co-?op|student|stagiaire)\b/i;

function hasStudentRoleNoun(title: string): boolean {
  for (const m of title.matchAll(STUDENT_ROLE_NOUN)) {
    const after = title.slice((m.index ?? 0) + m[0].length);
    if (!FOLLOWED_BY_STAFF.test(after)) return true;
  }
  return false;
}

export function classifyRole(title: string, employmentType?: string | null): RoleKind {
  const t = title.trim();
  if (!t) return 'other';
  // A recruiter is always staff, whichever audience they hire for. A recruiting internship is
  // titled "Recruiting Intern" or "Talent Acquisition Intern", neither of which says "recruiter".
  if (RECRUITER.test(t)) return 'other';

  if (hasStudentRoleNoun(t)) return 'internship';
  if (!SERVES_STUDENTS.test(t) && STUDENT_ROLE_PHRASE.test(t)) return 'internship';
  if (employmentType && STUDENT_EMPLOYMENT_TYPE.test(employmentType)) return 'internship';
  // New-grad markers win over a term or length: "Electrical Engineer New Grad - Summer 2027"
  // is a full-time job with a start date, not a work term.
  if (NEW_GRAD.test(t)) return 'new_grad';
  if (!SENIOR.test(t) && !NOT_A_WORK_TERM.test(t) && (SEASON_TERM.test(t) || DURATION.test(t))) {
    return 'internship';
  }
  return 'other';
}

/** Title contains "intern"/"co-op" outright. Used as a small ranking signal. */
export function isExplicitInternship(title: string): boolean {
  return hasStudentRoleNoun(title) && !RECRUITER.test(title);
}
