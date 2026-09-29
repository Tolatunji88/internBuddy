/**
 * From a posting's title, work out who is worth talking to. This is about *roles*, not people:
 * we never look anyone up. The output feeds search links the person clicks themselves.
 */
export interface PersonTarget {
  /** A job title to search for at the company. */
  title: string;
  why: string;
}

const STUDENT_MARKERS =
  /\b(intern(ship)?s?|co-?ops?|co\s+op|students?|new[\s-]*grad(uate)?s?|early[\s-]*career|pey|work[\s-]?terms?|placement|stagiaire|undergraduate|summer|fall|autumn|winter|spring)\b/gi;
/** Words that name a job. Preferred when picking which part of a title is the role. */
const JOB_NOUN =
  /\b(engineer|engineering|developer|development|scientist|science|analyst|analytics|designer|design|researcher|research|programmer|technician|architect|manager|management|accountant|investigator|specialist|consultant)\b/i;
/** Words that name a field. A fallback when no segment has a job noun. */
const FIELD_NOUN =
  /\b(product|operations|finance|robotics|hardware|software|firmware|data|machine learning|ml|ai|security|quant|marketing)\b/i;

const NOUNIFY: [RegExp, string][] = [
  [/\bdata science$/i, 'Data Scientist'],
  [/\bproduct management$/i, 'Product Manager'],
  [/\bengineering$/i, 'Engineer'],
  [/\bdevelopment$/i, 'Developer'],
  [/\bscience$/i, 'Scientist'],
  [/\bresearch$/i, 'Researcher'],
  [/\bdesign$/i, 'Designer'],
  [/\banalytics$/i, 'Analyst'],
];

/** "Software Engineering Intern (Summer 2027)" → "Software Engineer". */
export function baseRole(title: string): string {
  const stripped = title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b20\d\d\b/g, ' ')
    .replace(/\b(?:4|8|12|16)(?:\s*(?:-|–|to)\s*(?:8|12|16))?[\s-]*(?:months?|mos?)\b/gi, ' ')
    .replace(STUDENT_MARKERS, ' ');
  const segments = stripped
    // Separators: spaced slash/dash/pipe, a dash touching one side ("Intern-AI"), comma, colon.
    // Unspaced slashes ("AI/ML", "HW/SW") and hyphenated words ("Go-to-Market") stay whole.
    .split(/\s[-–—|/]\s|\s[-–—]|[-–—]\s|[,:|]/)
    .map((s) => s.replace(/\s{2,}/g, ' ').replace(/^[\s\-–—&/]+|[\s\-–—&/]+$/g, '').trim())
    .filter((s) => s.length > 1);
  let role = segments.find((s) => JOB_NOUN.test(s)) ?? segments.find((s) => FIELD_NOUN.test(s)) ?? segments[0] ?? '';
  // Only turn a trailing discipline into a job noun for a single discipline:
  // "Software Engineering" → "Software Engineer", but leave "Applied AI & Analytics" alone.
  if (!/&|\band\b/i.test(role)) {
    for (const [re, noun] of NOUNIFY) {
      if (re.test(role)) {
        role = role.replace(re, noun);
        break;
      }
    }
  }
  return role.replace(/\b(i|ii|iii|1|2|3)$/i, '').trim();
}

function managerFor(role: string): string {
  const r = role.toLowerCase();
  if (/data scien|machine learning|\bml\b|\bai\b/.test(r)) return 'Machine Learning Manager';
  if (/scientist|research/.test(r)) return 'Research Manager';
  if (/engineer|developer|programmer|firmware|software|hardware|robotics|security/.test(r)) return 'Engineering Manager';
  if (/analyst|analytics/.test(r)) return 'Analytics Manager';
  if (/designer|design/.test(r)) return 'Design Manager';
  if (/product/.test(r)) return 'Group Product Manager';
  if (/finance|accountant/.test(r)) return 'Finance Manager';
  return 'Hiring Manager';
}

export function targetsFor(jobTitle: string): PersonTarget[] {
  const role = baseRole(jobTitle);
  const targets: PersonTarget[] = [];
  if (role) {
    targets.push({
      title: role,
      why: 'Someone two or three years into this role can tell you what the work is actually like, and can refer you.',
    });
  }
  targets.push(
    { title: managerFor(role), why: 'Likely the hiring manager, or close to them.' },
    { title: 'Intern', why: 'Past interns know the team, the interview, and what got them in.' },
    {
      title: 'University Recruiter',
      why: 'Runs student hiring: can tell you timelines, and whether a referral changes anything.',
    },
  );
  return targets;
}
