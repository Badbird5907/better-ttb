/**
 * Degree programs: types for the U of T Arts & Science program catalogue, a
 * parser for the calendar's "completion requirements" HTML, and a deterministic
 * progress evaluator.
 *
 * The calendar publishes completion requirements as loosely-structured HTML.
 * There is no formal grammar, so this parser is a best-effort tokenizer over a
 * handful of stable conventions (see `parseCompletionRequirements`). Every
 * program keeps its `rawHtml` so the UI can always fall back to rendering the
 * original text, and each parse reports a `confidence` so callers can tell how
 * much of the structure was actually recovered.
 *
 * Guiding principle: prefer an honest "unknown" over a confident guess.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProgramType =
  | "specialist"
  | "major"
  | "minor"
  | "focus"
  | "certificate";

export type ProgramParseConfidence = "full" | "partial" | "none";

export type ProgramReq =
  | { kind: "course"; code: string }
  | { kind: "allOf"; items: ProgramReq[] }
  | { kind: "oneOf"; items: ProgramReq[] }
  /** "1.0 credit from: A/B/C" — earn `credits` worth from the `from` options. */
  | { kind: "chooseCredits"; credits: number; from: ProgramReq[] }
  /** "any 300+ level CSC course", "additional PHL courses to a total of 4.0". */
  | {
      kind: "pool";
      credits: number | null;
      subject?: string;
      minLevel?: number;
      levels?: number[];
      excludes?: string[];
      description: string;
    }
  /** Unparseable leaf — keep readable plain text so the UI can show it. */
  | { kind: "text"; text: string };

export interface ProgramClause {
  /** "1", "2a", or null for unnumbered clauses. */
  index: string | null;
  /** Plain text of the clause (tags stripped, zero-width spaces stripped). */
  text: string;
  /** Structured requirement, or null when the clause is purely advisory. */
  req: ProgramReq | null;
  /** Credit quantity this clause contributes, when stated or unambiguous. */
  credits: number | null;
  /** Every course code referenced in the clause, in first-seen order. */
  courses: string[];
  /** Notes / recommendations / consult-the-department prose. */
  advisory: boolean;
}

export interface ProgramReqSection {
  label: string | null;
  credits: number | null;
  clauses: ProgramClause[];
}

export interface ProgramCompletion {
  /** The original `field_completion_requirements.value` HTML, unmodified. */
  rawHtml: string;
  totalCredits: number | null;
  sections: ProgramReqSection[];
  confidence: ProgramParseConfidence;
}

export interface DegreeProgram {
  /** Post code (trimmed) for coded programs, path slug otherwise. */
  id: string;
  /** e.g. "ASMAJ1689"; null for the handful of programs with no post code. */
  code: string | null;
  /** Path alias tail, lowercase. */
  slug: string;
  /** Full calendar title. */
  title: string;
  /** Display name: title minus the trailing code and the degree parenthetical. */
  name: string;
  degree: "arts" | "science" | null;
  type: ProgramType;
  /** Subject areas (`field_section`). */
  sections: string[];
  changed: string;
  url: string;
  enrolmentRawHtml: string | null;
  completion: ProgramCompletion | null;
  /** Union of every course code appearing in the completion requirements. */
  courseCodes: string[];
}

export interface ProgramCatalog {
  version: 1;
  scrapedAt: string;
  source: string;
  programs: DegreeProgram[];
}

// ---------------------------------------------------------------------------
// Course + program code helpers
// ---------------------------------------------------------------------------

/**
 * U of T course codes: 3-4 letters, 2-3 digits (UTSC/UTM four-letter codes use
 * two), a session-length letter (H/Y) and a campus digit. Matches the regex
 * used by the requisites parser in the web app.
 */
const COURSE_CODE_SOURCE = "[A-Z]{3,4}\\d{2,3}[HY]\\d";
const COURSE_CODE_ANCHORED = new RegExp(`^${COURSE_CODE_SOURCE}$`);
const COURSE_CODE_GLOBAL = new RegExp(COURSE_CODE_SOURCE, "g");

/** Credit weight implied by a course code's session-length letter. */
export function courseCreditWeight(code: string): number | null {
  if (!COURSE_CODE_ANCHORED.test(code)) {
    return null;
  }

  // The session-length letter is the second-to-last character.
  const letter = code[code.length - 2];
  if (letter === "H") return 0.5;
  if (letter === "Y") return 1;
  return null;
}

/** Subject prefix of a course code, e.g. "CSC110Y1" -> "CSC". */
export function courseSubject(code: string): string | null {
  const match = code.match(/^([A-Z]{3,4})\d/);
  return match?.[1] ?? null;
}

/**
 * Course level, e.g. "CSC373H1" -> 300, "CSCC69H3" -> 300.
 *
 * St. George codes carry the level in the first of three digits; UTSC/UTM
 * codes are four letters + two digits, with the fourth letter as the level
 * (A=100 ... D=400). A greedy `[A-Z]{3,4}` must not eat the fourth letter and
 * then read a course-number digit as the level.
 */
export function courseLevel(code: string): number | null {
  const stGeorge = code.match(/^[A-Z]{3}(\d)\d{2}/);
  if (stGeorge?.[1] !== undefined) {
    const value = Number.parseInt(stGeorge[1], 10);
    return value >= 1 && value <= 9 ? value * 100 : null;
  }

  const suburban = code.match(/^[A-Z]{3}([A-D])\d{2}/);
  if (suburban?.[1] !== undefined) {
    return (suburban[1].charCodeAt(0) - 64) * 100;
  }

  return null;
}

/**
 * Post codes look like `ASMAJ1689`, sometimes with a stream letter suffix
 * (`ASMAJ1445C`) and occasionally an internal space (`AS CHRM`). Codes without
 * a four-digit number (only `AS CHRM`) are not treated as codes.
 */
const PROGRAM_CODE_RE = /^AS ?([A-Z]{3,4})(\d{4})([A-Z])?$/;

const TYPE_BY_PREFIX: Readonly<Record<string, ProgramType>> = {
  SPE: "specialist",
  MAJ: "major",
  MIN: "minor",
  FOC: "focus",
  CER: "certificate",
};

export interface ParsedProgramCode {
  code: string;
  prefix: string;
  number: string;
  /** Stream suffix letter, e.g. the "C" in ASMAJ1445C. */
  stream: string | null;
  type: ProgramType | null;
}

/** Parses a `field_post_code` value; returns null when it is not a post code. */
export function parseProgramCode(
  raw: string | null | undefined,
): ParsedProgramCode | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  const match = trimmed.match(PROGRAM_CODE_RE);
  if (!match) return null;

  const prefix = match[1] ?? "";
  return {
    code: trimmed,
    prefix,
    number: match[2] ?? "",
    stream: match[3] ?? null,
    type: TYPE_BY_PREFIX[prefix] ?? null,
  };
}

/**
 * Infers a program type from free text (title or slug). Used for the few
 * programs that have no post code. Ordered most- to least-specific.
 */
export function inferProgramType(text: string): ProgramType | null {
  const lower = text.toLowerCase();
  if (/\bspecialist\b/.test(lower)) return "specialist";
  if (/\bcertificate\b/.test(lower)) return "certificate";
  if (/\bfocus\b/.test(lower)) return "focus";
  if (/\bmajor\b/.test(lower)) return "major";
  if (/\bminor\b/.test(lower)) return "minor";
  return null;
}

export interface ProgramTitleParts {
  name: string;
  degree: "arts" | "science" | null;
}

/**
 * Cleans a calendar title into a display name: drops the trailing
 * " - ASXXX1234" (or the repeated-name suffix used by uncoded programs) and
 * lifts the "(Arts Program)" / "(Science Program)" parenthetical into `degree`.
 * Other parentheticals (streams, categories) are preserved in the name.
 */
export function parseProgramTitle(title: string): ProgramTitleParts {
  let name = title.trim();

  // Drop the trailing " - <post code>" or " - <repeated title>".
  const dashIndex = name.lastIndexOf(" - ");
  if (dashIndex > 0) {
    const head = name.slice(0, dashIndex).trim();
    if (head.length > 0) {
      name = head;
    }
  }

  let degree: "arts" | "science" | null = null;
  name = name
    .replace(/\s*\((Arts|Science) Program\)/i, (_full, kind: string) => {
      degree = kind.toLowerCase() === "arts" ? "arts" : "science";
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();

  return { name, degree };
}

// ---------------------------------------------------------------------------
// HTML utilities
// ---------------------------------------------------------------------------

const ZERO_WIDTH_SPACE = "​";

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

function codePoint(value: number, fallback: string): string {
  if (!Number.isFinite(value)) return fallback;
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,
    (entity, code: string) => {
      const normalized = code.toLowerCase();
      if (normalized.startsWith("#x")) {
        return codePoint(Number.parseInt(normalized.slice(2), 16), entity);
      }
      if (normalized.startsWith("#")) {
        return codePoint(Number.parseInt(normalized.slice(1), 10), entity);
      }
      return NAMED_ENTITIES[normalized] ?? entity;
    },
  );
}

/**
 * Converts a fragment of requirement HTML to plain text: course anchors become
 * their bare code, remaining tags are dropped, entities are decoded and the
 * zero-width space used as the calendar's "or" marker is removed.
 */
function htmlToText(html: string): string {
  const withCodes = html.replace(
    new RegExp(
      `<a\\b[^>]*href=['"][^'"]*\\/course\\/(${COURSE_CODE_SOURCE})[^'"]*['"][^>]*>[\\s\\S]*?<\\/a>`,
      "gi",
    ),
    " $1 ",
  );

  return decodeEntities(
    withCodes
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|li|ol|ul|div|tr)\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .split(ZERO_WIDTH_SPACE)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Course codes referenced by a fragment: anchor hrefs plus a bare-text scan. */
function extractCourseCodes(html: string): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();

  const push = (code: string): void => {
    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  };

  const anchorRe = new RegExp(
    `href=['"][^'"]*\\/course\\/(${COURSE_CODE_SOURCE})`,
    "gi",
  );
  for (const match of html.matchAll(anchorRe)) {
    const code = match[1];
    if (code !== undefined) push(code.toUpperCase());
  }

  // ~200 references across the catalogue are plain text rather than links
  // (mostly UTM/UTSC codes), so union in a text scan.
  for (const match of htmlToText(html).matchAll(COURSE_CODE_GLOBAL)) {
    push(match[0]);
  }

  return codes;
}

/** Finds the index just past the matching close tag for `name` opened at `from`. */
function findBlockEnd(html: string, name: string, from: number): number {
  const re = new RegExp(`<(\\/?)${name}\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) return match.index;
    } else if (!match[0].endsWith("/>")) {
      depth += 1;
    }
  }

  return html.length;
}

type ListKind = "decimal" | "alpha" | "bullet";

interface RawBlock {
  html: string;
  /** Which list (if any) this block came from. */
  list: ListKind | null;
  /** 1-based position within a decimal list. */
  ordinal: number | null;
}

const BLOCK_TAG_RE = /<(p|ol|ul|div|h[1-6]|table)\b([^>]*)>/gi;
const LIST_ITEM_RE = /<li\b[^>]*>/gi;

function listKindFromAttrs(tag: string, attrs: string): ListKind {
  if (tag === "ul") return "bullet";
  return /list-style-type:\s*(?:lower|upper)-(?:alpha|roman)/i.test(attrs)
    ? "alpha"
    : "decimal";
}

function extractListItems(inner: string): string[] {
  const items: string[] = [];
  LIST_ITEM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LIST_ITEM_RE.exec(inner)) !== null) {
    const start = match.index + match[0].length;
    const end = findBlockEnd(inner, "li", start);
    items.push(inner.slice(start, end));
    LIST_ITEM_RE.lastIndex = Math.max(end, start);
  }

  return items;
}

/** Splits requirement HTML into ordered paragraph / list-item blocks. */
function extractBlocks(html: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  BLOCK_TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = BLOCK_TAG_RE.exec(html)) !== null) {
    const tag = (match[1] ?? "").toLowerCase();
    const attrs = match[2] ?? "";
    const start = match.index + match[0].length;
    const end = findBlockEnd(html, tag, start);
    const inner = html.slice(start, end);

    if (tag === "ol" || tag === "ul") {
      const kind = listKindFromAttrs(tag, attrs);
      let ordinal = 0;
      for (const item of extractListItems(inner)) {
        ordinal += 1;
        blocks.push({
          html: item,
          list: kind,
          ordinal: kind === "decimal" ? ordinal : null,
        });
      }
      BLOCK_TAG_RE.lastIndex = Math.max(end, start);
      continue;
    }

    if (tag === "p") {
      blocks.push({ html: inner, list: null, ordinal: null });
      BLOCK_TAG_RE.lastIndex = Math.max(end, start);
      continue;
    }

    // div / heading / table wrappers: descend so nested paragraphs are found.
  }

  if (blocks.length === 0 && html.trim().length > 0) {
    blocks.push({ html, list: null, ordinal: null });
  }

  return blocks;
}

const NUMBER_PREFIX_RE = /^\s*(?:<[^>]+>\s*)*(\d{1,2}[a-z]?)[.)]\s/;

/**
 * Splits a paragraph on `<br>`. Numbered clauses are frequently packed into a
 * single `<p>` separated by line breaks, but line breaks are also used for
 * plain wrapping — so a break only starts a new line when the following
 * fragment begins with a clause number.
 */
function splitParagraphLines(html: string): string[] {
  const pieces = html.split(/<br\s*\/?>/gi);
  if (pieces.length <= 1) return [html];

  const lines: string[] = [];

  for (const piece of pieces) {
    if (piece.trim().length === 0) continue;
    if (lines.length === 0 || NUMBER_PREFIX_RE.test(piece)) {
      lines.push(piece);
    } else {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${piece}`;
    }
  }

  return lines.length > 0 ? lines : [html];
}

// ---------------------------------------------------------------------------
// Block classification
// ---------------------------------------------------------------------------

const SECTION_HEADER_RE =
  /^((?:first|second|third|fourth|higher|later|upper|final)\b[^:(]{0,60}?)(?:\s*\((\d+(?:\.\d+)?)\s*credits?\))?\s*[:*]\s*(?:\((\d+(?:\.\d+)?)\s*credits?\)\s*:?\s*)?/i;

/** Lead-ins for prose that restates or constrains an already-counted clause. */
const RESTATEMENT_RE =
  /^(?:these\s+\d|the\s+choices\s+in\b|of\s+these\b|the\s+above\b|note\b|notes\b|nb\b)/i;

const ADVISORY_RE =
  /^(?:notes?\s*:|\*|consult\b|students?\s+(?:are|who|with|may|should|must\s+consult|in\s+this\s+program\s+have|cannot|enrolled)|it\s+is\s+the\s+student|transfer\s+credits\b|courses?\s+with\s+a\b|this\s+program\b|we\s+recommend\b|recommended\b|no\s+more\s+than\b|please\b|for\s+(?:more\s+)?information\b|admission\b|the\s+following\s+courses\s+are\s+recommended)/i;

/** Lead-ins whose following `<ul>` bullets are whole alternatives, not a list. */
const ALTERNATIVE_LEAD_RE =
  /\b(?:either|any\s+one\s+of|one\s+of\s+the\s+following)\s*:?\s*$/i;

const TOTAL_CREDITS_RE = /^\((\d+(?:\.\d+)?)\s*credits?\b/i;
const ANY_CREDITS_RE = /(\d+(?:\.\d+)?)\s*credits?\b/i;

function isAdvisoryText(text: string, hasCourses: boolean): boolean {
  if (ADVISORY_RE.test(text)) return true;
  if (RESTATEMENT_RE.test(text)) return true;
  // Prose with neither a course nor a credit figure cannot be a requirement.
  if (!hasCourses && !ANY_CREDITS_RE.test(text)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Requirement tokenizer
// ---------------------------------------------------------------------------

interface PoolSpec {
  credits: number | null;
  subject?: string;
  minLevel?: number;
  levels?: number[];
  excludes?: string[];
  description: string;
}

type Token =
  | { k: "course"; code: string }
  | { k: "pool"; pool: PoolSpec }
  | { k: "credits"; credits: number }
  | { k: "from" }
  | { k: "text"; text: string }
  /** `&` is the "including" / "of which" separator: an ANDed subset clause. */
  | { k: "op"; v: ";" | "," | "/" | "&" }
  | { k: "lparen" }
  | { k: "rparen" };

/** `300-level`, `300+ level`, `300-/ 400-level`, `300- or 400-level`. */
const LEVEL_PHRASE_RE =
  /^((?:[1-9]00[\s\-+/,]*(?:or\s+)?)+)-?\s*level(?:s)?\b/i;

interface LevelInfo {
  minLevel?: number;
  levels?: number[];
}

function parseLevelPhrase(prefix: string): LevelInfo {
  const levels: number[] = [];
  for (const match of prefix.matchAll(/[1-9]00/g)) {
    const value = Number.parseInt(match[0], 10);
    if (!levels.includes(value)) levels.push(value);
  }

  if (levels.length === 0) return {};
  // "300+ level" is open-ended; an explicit list is not.
  if (prefix.includes("+")) {
    return { minLevel: Math.min(...levels) };
  }
  return { levels };
}

const SUBJECT_TOKEN_RE = /^[A-Z]{3,4}$/;

/** Consumes a trailing `except A, B and C` exclusion list. */
function matchExclusions(rest: string): { len: number; codes: string[] } | null {
  const head = rest.match(/^\s*(?:except|excluding|other\s+than|but\s+not)\b/i);
  if (!head) return null;

  let len = head[0].length;
  const codes: string[] = [];

  // Consume course codes plus the connective punctuation between them, and
  // stop at the first thing that is not part of the exclusion list.
  for (;;) {
    const tail = rest.slice(len);
    const step = tail.match(
      new RegExp(
        `^\\s*(?:(?:and|or|those\\s+listed\\s+in\\s+group\\s+[A-Z]|the\\s+following)\\s*[,/]?\\s*)*(${COURSE_CODE_SOURCE})\\s*[,/]?`,
        "i",
      ),
    );
    if (!step) break;
    const code = step[1];
    if (code !== undefined) codes.push(code.toUpperCase());
    len += step[0].length;
  }

  // Also swallow a trailing "and those listed in Group B" style phrase.
  const trailer = rest
    .slice(len)
    .match(/^\s*(?:and\s+)?those\s+listed\s+in\s+group\s+[A-Z]\b/i);
  if (trailer) len += trailer[0].length;

  return codes.length > 0 || trailer !== null ? { len, codes } : null;
}

/**
 * Matches a "pool" phrase: an open-ended set of courses described by subject
 * and/or level rather than enumerated, e.g. "any 300-/400-level CSC course
 * except CSC369H1" or "additional PHL courses".
 */
function matchPool(rest: string): { len: number; pool: PoolSpec } | null {
  const lead = rest.match(
    /^(?:(?:any|all|additional|other|further|more|remaining)\s+)*/i,
  );
  let len = lead ? lead[0].length : 0;

  let subject: string | undefined;
  let levelInfo: LevelInfo = {};
  let matched = false;

  /** Consumes `[at the] <level phrase>` at the current position, if present. */
  const takeLevel = (): boolean => {
    const atThe = rest.slice(len).match(/^\s*(?:at\s+(?:the\s+)?)?/i);
    const offset = atThe ? atThe[0].length : 0;
    const level = rest.slice(len + offset).match(LEVEL_PHRASE_RE);
    if (!level) return false;

    levelInfo = parseLevelPhrase(level[1] ?? "");
    len += offset + level[0].length;
    return true;
  };

  // Optional subject before the level, e.g. "CSC 300-level courses".
  const preSubject = rest.slice(len).match(/^([A-Z]{3,4})\s+(?=[1-9]00)/);
  if (preSubject?.[1] !== undefined) {
    subject = preSubject[1];
    len += preSubject[0].length;
  }

  if (takeLevel()) {
    matched = true;

    // Optional subject after the level, e.g. "300+ level ECO courses".
    const postSubject = rest.slice(len).match(/^\s+([A-Z]{3,4})\b/);
    const postCode = postSubject?.[1];
    if (
      subject === undefined &&
      postCode !== undefined &&
      SUBJECT_TOKEN_RE.test(postCode)
    ) {
      subject = postCode;
      len += postSubject?.[0].length ?? 0;
    }
  } else if (subject === undefined) {
    // Subject-only pool: "PHL courses", "additional CSC courses".
    const subjectOnly = rest.slice(len).match(/^([A-Z]{3,4})\s+courses?\b/);
    const code = subjectOnly?.[1];
    if (code !== undefined && SUBJECT_TOKEN_RE.test(code)) {
      subject = code;
      len += subjectOnly?.[0].length ?? 0;
      matched = true;
      // "CSC courses at the 200-/300-/400 level" — the level qualifies it.
      takeLevel();
    }
  }

  if (!matched) return null;

  const trailingCourses = rest.slice(len).match(/^\s+courses?\b/i);
  if (trailingCourses) len += trailingCourses[0].length;

  const excludes = matchExclusions(rest.slice(len));
  if (excludes) len += excludes.len;

  const description = rest.slice(0, len).replace(/\s+/g, " ").trim();

  return {
    len,
    pool: {
      credits: null,
      ...(subject !== undefined ? { subject } : {}),
      ...(levelInfo.minLevel !== undefined
        ? { minLevel: levelInfo.minLevel }
        : {}),
      ...(levelInfo.levels !== undefined ? { levels: levelInfo.levels } : {}),
      ...(excludes && excludes.codes.length > 0
        ? { excludes: excludes.codes }
        : {}),
      description,
    },
  };
}

const CREDITS_RE =
  /^(?:(?:at\s+least|to\s+a\s+total\s+of|a\s+total\s+of|to|an?\s+additional|a\s+further|up\s+to|any)\s+)*(\d+(?:\.\d+)?)\s*credits?\b/i;

/**
 * "including" / "of which" introduce a constraint on a *subset* of what was
 * just required, rather than an additional requirement. They are ANDed on, but
 * their credits are not added to the clause total (see `creditsForClause`).
 */
const SUBSET_MARKER_RE = /^(?:including|of\s+which|which\s+must\s+include)\b/i;

/**
 * Filler that links a credit quantifier to its option list, e.g. "of courses in
 * total selected from among the following groups:". Matched case-sensitively so
 * capitalised content ("Group A:", "Any 300-level ...") is never swallowed.
 */
const FROM_FILLER_RE =
  /^(?:selected|chosen|taken|from|of|in|among|amongst|the|following|list|lists|groups?|courses?|total|these|below|credit|credits)\b/;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    const joined = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (joined.length > 0 && /[a-z0-9]/i.test(joined)) {
      tokens.push({ k: "text", text: joined });
    }
    buffer = [];
  };

  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === "(" || ch === "[") {
      flush();
      tokens.push({ k: "lparen" });
      i += 1;
      continue;
    }

    if (ch === ")" || ch === "]") {
      flush();
      tokens.push({ k: "rparen" });
      i += 1;
      continue;
    }

    if (ch === "/" || ch === "," || ch === ";") {
      flush();
      tokens.push({ k: "op", v: ch });
      i += 1;
      continue;
    }

    if (ch === ":") {
      flush();
      i += 1;
      continue;
    }

    const rest = text.slice(i);

    const course = rest.match(new RegExp(`^${COURSE_CODE_SOURCE}`));
    if (course) {
      flush();
      tokens.push({ k: "course", code: course[0] });
      i += course[0].length;
      continue;
    }

    const credits = rest.match(CREDITS_RE);
    if (credits?.[1] !== undefined) {
      flush();
      tokens.push({ k: "credits", credits: Number.parseFloat(credits[1]) });
      i += credits[0].length;
      continue;
    }

    // A credit quantifier is followed by connective filler before its options.
    const lastToken = tokens[tokens.length - 1];
    if (
      buffer.length === 0 &&
      (lastToken?.k === "credits" || lastToken?.k === "from")
    ) {
      const filler = rest.match(FROM_FILLER_RE);
      if (filler) {
        if (lastToken.k !== "from") tokens.push({ k: "from" });
        i += filler[0].length;
        continue;
      }
    }

    const subset = rest.match(SUBSET_MARKER_RE);
    if (subset) {
      flush();
      tokens.push({ k: "op", v: "&" });
      i += subset[0].length;
      continue;
    }

    const pool = matchPool(rest);
    if (pool) {
      flush();
      tokens.push({ k: "pool", pool: pool.pool });
      i += pool.len;
      continue;
    }

    // Bare connectives between requirement items.
    const connective = rest.match(/^(and\/or|and|or|plus)\b/i);
    if (connective) {
      const word = (connective[1] ?? "").toLowerCase();
      const previous = tokens[tokens.length - 1];
      const followsItem =
        buffer.length === 0 &&
        (previous?.k === "course" ||
          previous?.k === "pool" ||
          previous?.k === "rparen");

      if (followsItem) {
        tokens.push({ k: "op", v: word === "and" || word === "plus" ? "," : "/" });
        i += connective[0].length;
        continue;
      }
    }

    const word = rest.match(/^[^\s/,;:()[\]]+/);
    if (word) {
      buffer.push(word[0]);
      i += word[0].length;
    } else {
      i += 1;
    }
  }

  flush();
  return tokens;
}

// ---------------------------------------------------------------------------
// Requirement parser
// ---------------------------------------------------------------------------

/**
 * Words that are pure list scaffolding. A text leaf built only from these
 * carries no requirement information (e.g. "Group A", "must be", "and/or"), so
 * it is dropped rather than kept as an unparsed leaf.
 */
const SCAFFOLD_WORDS = new Set([
  "a", "above", "all", "among", "amongst", "an", "and", "any", "are", "as",
  "at", "be", "below", "both", "by", "can", "choose", "chosen", "complete",
  "completed", "completion", "course", "courses", "credit", "credits", "each",
  "eg", "either", "listed", "neither",
  "etc", "follow", "following", "follows", "for", "four", "from", "group",
  "groups", "ie", "in", "include", "included", "includes", "including", "is",
  "least", "level", "levels", "list", "lists", "may", "more", "must", "no",
  "not", "of", "one", "or", "other", "others", "out", "per", "plus", "select",
  "selected", "take", "taken", "than", "that", "the", "these", "this", "those",
  "three", "to", "total", "two", "up", "which", "will", "with", "year", "years",
]);

function isJunkText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3) return true;

  const words = trimmed
    .toLowerCase()
    .replace(/[^a-z\s]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) return true;
  // Single letters are list labels ("Group B", "a)"), never course content.
  return words.every((word) => word.length === 1 || SCAFFOLD_WORDS.has(word));
}

class ReqParser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  private atEnd(): boolean {
    const token = this.peek();
    return token === undefined || token.k === "rparen";
  }

  private atSegmentEnd(): boolean {
    const token = this.peek();
    if (token === undefined || token.k === "rparen") return true;
    return token.k === "op" && (token.v === ";" || token.v === "&");
  }

  /** Is there another credit quantifier ahead at this bracket depth? */
  private hasCreditsAhead(): boolean {
    let depth = 0;
    for (let i = this.pos; i < this.tokens.length; i += 1) {
      const token = this.tokens[i]!;
      if (token.k === "lparen") depth += 1;
      else if (token.k === "rparen") {
        if (depth === 0) return false;
        depth -= 1;
      } else if (depth === 0 && token.k === "credits") return true;
    }
    return false;
  }

  /** `;` / "including"-separated segments, ANDed together. */
  parseSequence(optionMode = false): ProgramReq {
    const parts: ProgramReq[] = [this.parseList(optionMode)];

    while (!this.atEnd()) {
      const token = this.peek();
      if (token?.k === "op" && (token.v === ";" || token.v === "&")) {
        this.next();
        parts.push(this.parseList(optionMode));
        continue;
      }
      break;
    }

    return combine("allOf", parts);
  }

  /**
   * A comma-separated list. Commas mean AND, except inside an option list
   * introduced by a credit quantifier ("1.0 credit from: A, B, C") where they
   * enumerate alternatives.
   */
  private parseList(optionMode: boolean): ProgramReq {
    const parts: ProgramReq[] = [];

    while (!this.atSegmentEnd()) {
      parts.push(this.parseOr(optionMode));

      const separator = this.peek();
      if (separator?.k === "op" && separator.v === ",") {
        this.next();
        continue;
      }
      if (separator?.k === "op") break;
      if (separator === undefined || separator.k === "rparen") break;
      // Adjacent items with no separator: keep consuming the same list.
    }

    return combine(optionMode ? "oneOf" : "allOf", mergeDanglingCredits(parts));
  }

  /** A `/`-joined OR chain. */
  private parseOr(optionMode: boolean): ProgramReq {
    const parts: ProgramReq[] = [this.parsePrimary(optionMode)];

    for (;;) {
      const token = this.peek();
      if (token?.k === "op" && token.v === "/") {
        this.next();
        parts.push(this.parsePrimary(optionMode));
        continue;
      }
      break;
    }

    return combine("oneOf", parts);
  }

  private parsePrimary(optionMode: boolean): ProgramReq {
    const token = this.next();

    if (token === undefined) return { kind: "text", text: "" };

    if (token.k === "lparen") {
      // Parentheses always reset to AND semantics for their contents.
      const inner = this.parseSequence(false);
      if (this.peek()?.k === "rparen") this.next();
      return inner;
    }

    if (token.k === "course") return { kind: "course", code: token.code };

    if (token.k === "pool") return { kind: "pool", ...token.pool };

    if (token.k === "credits") return this.parseQuantified(token.credits);

    if (token.k === "from") {
      // A stray marker with no quantifier: parse the rest as alternatives.
      return this.parseList(true);
    }

    if (token.k === "text") return { kind: "text", text: token.text };

    // Stray operator or close paren.
    return { kind: "text", text: "" };
  }

  /**
   * A credit quantifier and the thing it quantifies:
   * - followed by a pool  -> that pool, with the credit target attached
   * - followed by options -> `chooseCredits`
   */
  private parseQuantified(credits: number): ProgramReq {
    const hadFromMarker = this.peek()?.k === "from";
    if (hadFromMarker) this.next();

    // Skip a stray comma between the quantifier and its options.
    const afterMarker = this.peek();
    if (afterMarker?.k === "op" && afterMarker.v === ",") this.next();

    const token = this.peek();

    if (token?.k === "pool") {
      this.next();
      return { kind: "pool", ...token.pool, credits };
    }

    if (token === undefined || token.k === "rparen" || token.k === "op") {
      return { kind: "chooseCredits", credits, from: [] };
    }

    const from: ProgramReq[] = [];

    for (;;) {
      from.push(...flattenOptions(this.parseList(true)));

      // "N credits from the following groups: Group A: ...; Group B: ..." —
      // the option list continues past `;` until the next credit quantifier.
      const separator = this.peek();
      if (
        hadFromMarker &&
        separator?.k === "op" &&
        separator.v === ";" &&
        !this.hasCreditsAhead()
      ) {
        this.next();
        continue;
      }
      break;
    }

    if (from.length === 0) {
      return { kind: "chooseCredits", credits, from: [] };
    }

    // A lone unquantified pool is better expressed as a credit-targeted pool.
    const only = from[0];
    if (from.length === 1 && only?.kind === "pool" && only.credits === null) {
      return { ...only, credits };
    }

    return { kind: "chooseCredits", credits, from };
  }
}

/**
 * Rewrites `<description text>, N credits` (a quantifier with no option list)
 * into a described pool, e.g. "Additional philosophy courses, to a total of 4.0
 * credits" becomes a 4.0-credit pool described by the preceding phrase.
 */
function mergeDanglingCredits(parts: ProgramReq[]): ProgramReq[] {
  const merged: ProgramReq[] = [];

  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (
      part.kind === "chooseCredits" &&
      part.from.length === 0 &&
      previous?.kind === "text" &&
      !isJunkText(previous.text)
    ) {
      merged[merged.length - 1] = {
        kind: "pool",
        credits: part.credits,
        description: previous.text,
      };
      continue;
    }
    merged.push(part);
  }

  return merged;
}

function combine(
  kind: "allOf" | "oneOf",
  parts: ProgramReq[],
): ProgramReq {
  const items = parts.filter(
    (part) => !(part.kind === "text" && isJunkText(part.text)),
  );

  if (items.length === 0) return { kind: "text", text: "" };
  if (items.length === 1) return items[0]!;

  // Flatten same-kind nesting so the tree stays shallow and comparable.
  const flat: ProgramReq[] = [];
  for (const item of items) {
    if (item.kind === kind) {
      flat.push(...item.items);
    } else {
      flat.push(item);
    }
  }

  return { kind, items: dedupe(flat) };
}

function dedupe(items: ProgramReq[]): ProgramReq[] {
  const seen = new Set<string>();
  const result: ProgramReq[] = [];

  for (const item of items) {
    if (item.kind === "course") {
      if (seen.has(item.code)) continue;
      seen.add(item.code);
    }
    result.push(item);
  }

  return result;
}

/** Flattens a parsed option list into the leaves of a `chooseCredits.from`. */
function flattenOptions(req: ProgramReq): ProgramReq[] {
  const out: ProgramReq[] = [];

  const walk = (node: ProgramReq): void => {
    if (node.kind === "oneOf") {
      for (const item of node.items) walk(item);
      return;
    }
    if (node.kind === "text") {
      if (!isJunkText(node.text)) out.push(node);
      return;
    }
    out.push(node);
  };

  walk(req);
  return out;
}

function containsTextLeaf(req: ProgramReq): boolean {
  switch (req.kind) {
    case "text":
      return true;
    case "allOf":
    case "oneOf":
      return req.items.some(containsTextLeaf);
    case "chooseCredits":
      return req.from.some(containsTextLeaf);
    default:
      return false;
  }
}

/**
 * Whether a requirement carries anything actionable. A credit quantifier whose
 * options are all unparsed prose ("2.0 credits arranged with the coordinator")
 * is not structured — we cannot say which courses would satisfy it.
 */
function hasStructure(req: ProgramReq): boolean {
  switch (req.kind) {
    case "course":
      return true;
    case "pool":
      // Either a matchable constraint or at least a credit target.
      return isPoolConstrained(req) || req.credits !== null;
    case "chooseCredits":
      return req.from.some(hasStructure);
    case "allOf":
    case "oneOf":
      return req.items.some(hasStructure);
    case "text":
      return false;
  }
}

/** Credit weight a clause contributes, when it can be derived unambiguously. */
function creditsForReq(req: ProgramReq): number | null {
  switch (req.kind) {
    case "course":
      return courseCreditWeight(req.code);
    case "chooseCredits":
      return req.credits;
    case "pool":
      return req.credits;
    case "allOf": {
      let total = 0;
      for (const item of req.items) {
        const value = creditsForReq(item);
        if (value === null) return null;
        total += value;
      }
      return round2(total);
    }
    case "oneOf": {
      // Only unambiguous when every alternative is worth the same.
      let value: number | null = null;
      for (const item of req.items) {
        const current = creditsForReq(item);
        if (current === null) return null;
        if (value === null) value = current;
        else if (value !== current) return null;
      }
      return value;
    }
    case "text":
      return null;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Credits a clause contributes. Normally `creditsForReq`, except when the
 * clause uses "including" / "of which": those name a *subset* of the credits
 * already required, so the clause is worth the largest component rather than
 * the sum ("4.0 credits, including 1.0 credit at the 300+ level" is 4.0).
 */
function creditsForClause(req: ProgramReq, text: string): number | null {
  if (req.kind === "allOf" && SUBSET_TEXT_RE.test(text)) {
    let max: number | null = null;
    for (const item of req.items) {
      const value = creditsForReq(item);
      if (value === null) continue;
      if (max === null || value > max) max = value;
    }
    return max;
  }

  return creditsForReq(req);
}

const SUBSET_TEXT_RE = /\b(?:including|of\s+which|which\s+must\s+include)\b/i;

// ---------------------------------------------------------------------------
// Completion-requirements parser
// ---------------------------------------------------------------------------

/**
 * Parses `field_completion_requirements.value` into sections of clauses.
 *
 * Conventions recognised (see the module docstring for caveats):
 * - A leading fully-parenthesised `(N.N credits ...)` paragraph is the total.
 * - `<em>First year</em> (2.5 credits):` style lines open a section.
 * - `1.` `2.` prefixes (in paragraphs, after `<br>`, or as plain `<ol>` items)
 *   delimit requirement clauses.
 * - `<ol style="list-style-type: lower-alpha">` items and "Note"-style prose
 *   are advisory.
 * - `<ul>` bullets attach to the preceding clause (they enumerate its groups
 *   or restate its constraints) rather than becoming clauses of their own.
 * - Within a clause: `;` and `,` are AND, `/` is OR, `( ... )` groups an AND
 *   pair acting as one alternative.
 */
export function parseCompletionRequirements(
  rawHtml: string,
): ProgramCompletion {
  const sections: ProgramReqSection[] = [];
  let current: ProgramReqSection | null = null;
  let totalCredits: number | null = null;

  const ensureSection = (): ProgramReqSection => {
    if (current === null) {
      current = { label: null, credits: null, clauses: [] };
      sections.push(current);
    }
    return current;
  };

  const blocks = extractBlocks(rawHtml);
  let blockIndex = 0;
  /** How many `<ul>` bullets have been merged into the current clause. */
  let bulletCount = 0;
  /** Whether those bullets are whole alternatives (decided by the lead-in). */
  let bulletsAreAlternatives = false;

  for (const block of blocks) {
    const lines =
      block.list === null ? splitParagraphLines(block.html) : [block.html];

    for (const lineHtml of lines) {
      blockIndex += 1;
      let text = htmlToText(lineHtml);
      if (text.length === 0) continue;

      const courses = extractCourseCodes(lineHtml);

      // The opening "(N.N credits ...)" line states the program total.
      if (blockIndex === 1 && block.list === null) {
        const total = text.match(TOTAL_CREDITS_RE);
        if (total?.[1] !== undefined) {
          totalCredits = Number.parseFloat(total[1]);
          // Consumed entirely when the whole line is the parenthetical.
          if (/^\([^()]*(?:\([^()]*\)[^()]*)*\)$/.test(text)) continue;
        }
      }

      // Bullets belong to the clause they follow: they enumerate its groups or
      // its alternatives rather than forming clauses of their own.
      if (block.list === "bullet") {
        const target = current?.clauses[current.clauses.length - 1];
        if (target !== undefined) {
          // A lead-in like "Completion of either" makes each bullet a whole
          // alternative, so parenthesise them and join with OR. Otherwise the
          // bullets extend the clause's list (Group A / Group B / ...).
          // Decided from the original lead-in, before it grows with bullets.
          if (bulletCount === 0) {
            bulletsAreAlternatives = ALTERNATIVE_LEAD_RE.test(target.text);
          }
          const alternatives = bulletsAreAlternatives;
          const piece = alternatives ? `(${text.replace(/\s+or\s*$/i, "")})` : text;
          const separator = alternatives && bulletCount > 0 ? " / " : " ";

          target.text = `${target.text}${separator}${piece}`
            .replace(/\s+/g, " ")
            .trim();
          bulletCount += 1;

          for (const code of courses) {
            if (!target.courses.includes(code)) target.courses.push(code);
          }

          // The lead-in alone may have looked advisory ("Completion of either"
          // has no courses); re-judge now that the bullets are attached.
          target.advisory = isAdvisoryText(
            target.text,
            target.courses.length > 0,
          );
          target.req = target.advisory ? null : reparseClause(target.text);
          target.credits =
            target.req === null
              ? null
              : creditsForClause(target.req, target.text);
          continue;
        }
      }

      // Section headers.
      if (block.list === null) {
        const header = text.match(SECTION_HEADER_RE);
        if (header) {
          const label = (header[1] ?? "").trim();
          const creditText = header[2] ?? header[3];
          current = {
            label: label.length > 0 ? label : null,
            credits:
              creditText !== undefined ? Number.parseFloat(creditText) : null,
            clauses: [],
          };
          sections.push(current);
          text = text.slice(header[0].length).trim();
          if (text.length === 0) continue;
        }
      }

      // Clause numbering.
      let index: string | null = null;
      const numbered = text.match(/^(\d{1,2}[a-z]?)[.)]\s*/);
      if (numbered?.[1] !== undefined) {
        index = numbered[1];
        text = text.slice(numbered[0].length).trim();
      } else if (block.list === "decimal" && block.ordinal !== null) {
        index = String(block.ordinal);
      }

      const advisory =
        block.list === "alpha" || isAdvisoryText(text, courses.length > 0);

      const req = advisory ? null : reparseClause(text);

      bulletCount = 0;
      ensureSection().clauses.push({
        index,
        text,
        req,
        credits: req ? creditsForClause(req, text) : null,
        courses,
        advisory,
      });
    }
  }

  // Fall back to the first credit figure anywhere in the requirements.
  if (totalCredits === null) {
    const wholeText = htmlToText(rawHtml);
    const parenthesised = wholeText.match(
      /\((\d+(?:\.\d+)?)\s*credits?\b[^)]*\)/i,
    );
    const anywhere = parenthesised ?? wholeText.match(ANY_CREDITS_RE);
    if (anywhere?.[1] !== undefined) {
      totalCredits = Number.parseFloat(anywhere[1]);
    }
  }

  return {
    rawHtml,
    totalCredits,
    sections,
    confidence: scoreConfidence(sections),
  };
}

function reparseClause(text: string): ProgramReq | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  try {
    const req = new ReqParser(tokenize(trimmed)).parseSequence();
    if (req.kind === "text" && req.text.trim().length === 0) {
      return { kind: "text", text: trimmed };
    }
    return hasStructure(req) ? req : { kind: "text", text: trimmed };
  } catch {
    return { kind: "text", text: trimmed };
  }
}

/**
 * "full"    — every non-advisory clause produced a structured (non-text) req.
 * "partial" — some clauses produced structure, others fell back to text.
 * "none"    — nothing structured was extracted.
 *
 * Note that a "full" parse may still contain nested `text` leaves for prose
 * fragments inside an otherwise structured clause; use `completionIsFullyTyped`
 * when you need the stricter guarantee.
 */
function scoreConfidence(
  sections: ProgramReqSection[],
): ProgramParseConfidence {
  let total = 0;
  let parsed = 0;

  for (const section of sections) {
    for (const clause of section.clauses) {
      if (clause.advisory) continue;
      total += 1;
      const req = clause.req;
      if (req !== null && req.kind !== "text" && hasStructure(req)) parsed += 1;
    }
  }

  if (total === 0 || parsed === 0) return "none";
  return parsed === total ? "full" : "partial";
}

/**
 * Stricter than `confidence === "full"`: true when no clause contains any
 * unparsed prose fragment anywhere in its requirement tree.
 */
export function completionIsFullyTyped(completion: ProgramCompletion): boolean {
  return completion.sections.every((section) =>
    section.clauses.every(
      (clause) =>
        clause.advisory ||
        (clause.req !== null && !containsTextLeaf(clause.req)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Progress evaluation
// ---------------------------------------------------------------------------

export type ClauseStatus = "met" | "partial" | "unmet" | "unknown";

export interface ClauseProgress {
  status: ClauseStatus;
  earnedCredits: number;
  requiredCredits: number | null;
  matchedCourses: string[];
  /** True when the user manually marked this clause satisfied. */
  manual: boolean;
}

export interface ProgramProgress {
  totalCredits: number | null;
  earnedCredits: number;
  /** Percentage of `totalCredits` earned, clamped 0-100; null when unknown. */
  percent: number | null;
  /** Keyed by `${sectionIndex}.${clauseIndexWithinSection}`. */
  clauses: Record<string, ClauseProgress>;
  metClauses: number;
  totalClauses: number;
}

/** Stable key for a clause within a program's parsed sections. */
export function programClauseKey(
  sectionIndex: number,
  clauseIndex: number,
): string {
  return `${sectionIndex}.${clauseIndex}`;
}

function weightOf(
  code: string,
  completed: Readonly<Record<string, number | null>>,
): number {
  const override = completed[code];
  if (typeof override === "number" && Number.isFinite(override)) {
    return override;
  }
  return courseCreditWeight(code) ?? 0;
}

function poolAccepts(pool: PoolSpec | Extract<ProgramReq, { kind: "pool" }>, code: string): boolean {
  if (pool.excludes?.includes(code)) return false;

  if (pool.subject !== undefined && courseSubject(code) !== pool.subject) {
    return false;
  }

  const level = courseLevel(code);
  if (pool.levels !== undefined) {
    if (level === null || !pool.levels.includes(level)) return false;
  }
  if (pool.minLevel !== undefined) {
    if (level === null || level < pool.minLevel) return false;
  }

  // A pool with no subject and no level constraint matches nothing we can
  // justify — the evaluator reports "unknown" for these instead of guessing.
  if (
    pool.subject === undefined &&
    pool.levels === undefined &&
    pool.minLevel === undefined
  ) {
    return false;
  }

  return true;
}

function isPoolConstrained(
  pool: Extract<ProgramReq, { kind: "pool" }>,
): boolean {
  return (
    pool.subject !== undefined ||
    pool.levels !== undefined ||
    pool.minLevel !== undefined
  );
}

function reqHasPool(req: ProgramReq): boolean {
  switch (req.kind) {
    case "pool":
      return true;
    case "allOf":
    case "oneOf":
      return req.items.some(reqHasPool);
    case "chooseCredits":
      return req.from.some(reqHasPool);
    default:
      return false;
  }
}

/** Mutable bookkeeping for one clause's claim walk. */
interface ClaimState {
  /** Courses still unclaimed by any clause; claiming removes from this set. */
  available: Set<string>;
  /** Courses this clause has claimed, in claim order. */
  claimed: string[];
  /** Credits this clause has claimed so far. */
  earned: number;
}

/**
 * Greedily claims completed courses for `req` out of `available`, removing what
 * it claims so a course is never counted by two clauses. `cap` bounds how many
 * credits this requirement may claim (null when the clause's worth is unknown).
 *
 * Assignment order, all deterministic:
 * - `oneOf` claims exactly one alternative. Every branch is first tried against
 *   a copy of the pool without consuming anything; the winner is a fully-met
 *   branch, else the branch earning the most credits, else the first in
 *   document order. Losing branches keep their courses available for later
 *   clauses.
 * - Under a cap, candidates are claimed best fit first: the largest candidate
 *   that still fits the remaining room, and only when nothing fits (and the cap
 *   is not yet reached) the smallest overshooting one. A 1.0-credit Y course
 *   may therefore still satisfy a remaining 0.5 need, but never in preference
 *   to an exact fit.
 * - A pool that cannot be scored — no credit target of its own and no clause
 *   cap to bound it — claims nothing. It could never report those credits, and
 *   consuming them would starve the clauses that can.
 */
function claimMatches(
  req: ProgramReq,
  available: Set<string>,
  completed: Readonly<Record<string, number | null>>,
  cap: number | null,
): string[] {
  const state: ClaimState = { available, claimed: [], earned: 0 };
  claimReq(req, state, completed, cap);
  return state.claimed;
}

function takeCourse(
  code: string,
  state: ClaimState,
  completed: Readonly<Record<string, number | null>>,
  cap: number | null,
): void {
  if (!state.available.has(code)) return;
  if (cap !== null && state.earned >= cap) return;
  state.available.delete(code);
  state.claimed.push(code);
  state.earned = round2(state.earned + weightOf(code, completed));
}

function claimReq(
  node: ProgramReq,
  state: ClaimState,
  completed: Readonly<Record<string, number | null>>,
  cap: number | null,
): void {
  switch (node.kind) {
    case "course":
      takeCourse(node.code, state, completed, cap);
      return;

    case "allOf":
      // Every item is required, so document order it is.
      for (const item of node.items) claimReq(item, state, completed, cap);
      return;

    case "oneOf":
      claimBestBranch(node.items, state, completed, cap);
      return;

    case "chooseCredits":
      // A nested list keeps its own target when the clause has no cap of its
      // own, so it cannot absorb more than it is worth.
      claimBestFit(
        node.from,
        (option) => optionWeight(option, completed),
        (option, limit) => claimReq(option, state, completed, limit),
        state,
        cap ?? round2(state.earned + node.credits),
      );
      return;

    case "pool": {
      if (!isPoolConstrained(node)) return;
      const limit =
        cap ?? (node.credits === null ? null : round2(state.earned + node.credits));
      // Unscoreable: claiming here would consume courses this clause can never
      // report as earned (see the doc comment on `claimMatches`).
      if (limit === null) return;

      // Deterministic order: alphabetical over the still-available courses,
      // best fit first within that order.
      const candidates = [...state.available]
        .sort()
        .filter((code) => poolAccepts(node, code));

      claimBestFit(
        candidates,
        (code) => weightOf(code, completed),
        (code, codeLimit) => takeCourse(code, state, completed, codeLimit),
        state,
        limit,
      );
      return;
    }

    case "text":
      return;
  }
}

/** Credits an option of a `chooseCredits` list is expected to be worth. */
function optionWeight(
  option: ProgramReq,
  completed: Readonly<Record<string, number | null>>,
): number | null {
  return option.kind === "course"
    ? weightOf(option.code, completed)
    : creditsForReq(option);
}

/**
 * Claims from `candidates` under `cap`, preferring exact fits: each round takes
 * the largest candidate that still fits the remaining room, falling back to the
 * smallest overshooting candidate when nothing fits. Candidates of unknown
 * weight (open pools, prose) come last, in their original order. Ties keep the
 * candidate order given, so the result is deterministic.
 */
function claimBestFit<T>(
  candidates: readonly T[],
  weigh: (candidate: T) => number | null,
  claim: (candidate: T, cap: number) => void,
  state: ClaimState,
  cap: number,
): void {
  const pending = candidates.map((candidate, index) => ({
    candidate,
    index,
    weight: weigh(candidate),
  }));
  const used = new Set<number>();

  while (state.earned < cap) {
    const room = round2(cap - state.earned);
    let best: { candidate: T; index: number; weight: number } | undefined;

    for (const entry of pending) {
      const weight = entry.weight;
      if (used.has(entry.index) || weight === null || weight > room) continue;
      if (best === undefined || weight > best.weight) {
        best = { candidate: entry.candidate, index: entry.index, weight };
      }
    }

    if (best === undefined) {
      // Nothing fits the remaining room: the smallest overshoot still counts
      // (the student really did complete it), but only one of them — the loop
      // ends as soon as it lands.
      for (const entry of pending) {
        const weight = entry.weight;
        if (used.has(entry.index) || weight === null) continue;
        if (best === undefined || weight < best.weight) {
          best = { candidate: entry.candidate, index: entry.index, weight };
        }
      }
    }

    if (best === undefined) break;
    used.add(best.index);
    claim(best.candidate, cap);
  }

  for (const entry of pending) {
    if (used.has(entry.index) || entry.weight !== null) continue;
    if (state.earned >= cap) break;
    claim(entry.candidate, cap);
  }
}

/**
 * Claims a single alternative of a `oneOf`. Branches are evaluated against a
 * copy of the pool so nothing is consumed by a branch that loses.
 */
function claimBestBranch(
  items: readonly ProgramReq[],
  state: ClaimState,
  completed: Readonly<Record<string, number | null>>,
  cap: number | null,
): void {
  let best: { claimed: string[]; earned: number; met: boolean } | undefined;

  for (const item of items) {
    const trial: ClaimState = {
      available: new Set(state.available),
      claimed: [],
      earned: state.earned,
    };
    claimReq(item, trial, completed, cap);

    const branch = {
      claimed: trial.claimed,
      earned: round2(trial.earned - state.earned),
      met: statusOf(item, new Set(trial.claimed), completed) === "met",
    };

    const better =
      best === undefined ||
      (branch.met && !best.met) ||
      (branch.met === best.met && branch.earned > best.earned);
    if (better) best = branch;
  }

  if (best === undefined) return;
  for (const code of best.claimed) takeCourse(code, state, completed, cap);
}

function statusOf(
  req: ProgramReq,
  matched: ReadonlySet<string>,
  completed: Readonly<Record<string, number | null>>,
): ClauseStatus {
  switch (req.kind) {
    case "course":
      return matched.has(req.code) ? "met" : "unmet";

    case "allOf": {
      const statuses = req.items.map((item) =>
        statusOf(item, matched, completed),
      );
      if (statuses.every((s) => s === "met")) return "met";
      if (statuses.some((s) => s === "met" || s === "partial")) return "partial";
      if (statuses.every((s) => s === "unknown")) return "unknown";
      return "unmet";
    }

    case "oneOf": {
      const statuses = req.items.map((item) =>
        statusOf(item, matched, completed),
      );
      if (statuses.some((s) => s === "met")) return "met";
      if (statuses.some((s) => s === "partial")) return "partial";
      if (statuses.every((s) => s === "unknown")) return "unknown";
      return "unmet";
    }

    case "chooseCredits": {
      const earned = creditsFromMatched(req, matched, completed);
      if (earned >= req.credits) return "met";
      return earned > 0 ? "partial" : "unmet";
    }

    case "pool": {
      if (!isPoolConstrained(req)) return "unknown";
      const earned = creditsFromMatched(req, matched, completed);
      if (req.credits === null) return "unknown";
      if (earned >= req.credits) return "met";
      return earned > 0 ? "partial" : "unmet";
    }

    case "text":
      return "unknown";
  }
}

/** Credits among `matched` that this requirement can actually account for. */
function creditsFromMatched(
  req: ProgramReq,
  matched: ReadonlySet<string>,
  completed: Readonly<Record<string, number | null>>,
): number {
  let total = 0;
  for (const code of matched) {
    if (reqAccepts(req, code)) total = round2(total + weightOf(code, completed));
  }
  return total;
}

function reqAccepts(req: ProgramReq, code: string): boolean {
  switch (req.kind) {
    case "course":
      return req.code === code;
    case "allOf":
    case "oneOf":
      return req.items.some((item) => reqAccepts(item, code));
    case "chooseCredits":
      return req.from.some((item) => reqAccepts(item, code));
    case "pool":
      return isPoolConstrained(req) && poolAccepts(req, code);
    case "text":
      return false;
  }
}

/**
 * Evaluates a student's completed courses against a program's requirements.
 *
 * `completed` maps course code to an explicit credit weight (or null to use the
 * weight implied by the code). `manualOverrides` holds clause keys the student
 * has marked satisfied by hand — those report `status: "met", manual: true`.
 *
 * Each completed course is assigned to at most one clause. Clauses that name
 * courses explicitly are served before open-ended pools, and clauses are
 * otherwise processed in document order, which makes the result deterministic.
 * Within a clause the order is the one `claimMatches` documents: one branch per
 * `oneOf`, best fit under a cap, and no claiming at all by a pool that cannot
 * be scored.
 *
 * A clause never reports more than it is worth: `earnedCredits` is clamped to
 * the clause's credits, and a manually overridden clause reports at least them
 * (it is "met", so showing it as 0.0 of 2.0 would contradict its own status).
 */
export function evaluateProgram(
  program: DegreeProgram,
  completed: Readonly<Record<string, number | null>>,
  manualOverrides: ReadonlySet<string>,
): ProgramProgress {
  const completion = program.completion;
  const clauses: Record<string, ClauseProgress> = {};

  if (completion === null) {
    return {
      totalCredits: null,
      earnedCredits: 0,
      percent: null,
      clauses,
      metClauses: 0,
      totalClauses: 0,
    };
  }

  interface Entry {
    key: string;
    req: ProgramReq;
    cap: number | null;
    explicit: boolean;
  }

  const entries: Entry[] = [];
  let totalClauses = 0;
  /** Credits contributed by overridden clauses that claim nothing at all. */
  let overrideCredits = 0;

  completion.sections.forEach((section, sectionIndex) => {
    section.clauses.forEach((clause, clauseIndex) => {
      if (clause.advisory) return;
      const key = programClauseKey(sectionIndex, clauseIndex);
      totalClauses += 1;

      if (clause.req === null) {
        // Nothing to match against, so an override is all this clause can be.
        const manual = manualOverrides.has(key);
        const earned = manual ? (clause.credits ?? 0) : 0;
        overrideCredits = round2(overrideCredits + earned);
        clauses[key] = {
          status: manual ? "met" : "unknown",
          earnedCredits: earned,
          requiredCredits: clause.credits,
          matchedCourses: [],
          manual,
        };
        return;
      }

      entries.push({
        key,
        req: clause.req,
        cap: clause.credits,
        explicit: !reqHasPool(clause.req),
      });
    });
  });

  const available = new Set(Object.keys(completed));
  let earnedCredits = overrideCredits;

  // Two passes so enumerated course lists claim their courses before pools.
  for (const pass of [true, false]) {
    for (const entry of entries) {
      if (entry.explicit !== pass) continue;

      const claimed = claimMatches(entry.req, available, completed, entry.cap);
      const matched = new Set(claimed);
      const claimedCredits = claimed.reduce(
        (sum, code) => round2(sum + weightOf(code, completed)),
        0,
      );

      // A single Y course may overshoot a 0.5-credit clause; the clause is
      // still only worth what it is worth.
      let clauseEarned =
        entry.cap === null ? claimedCredits : Math.min(claimedCredits, entry.cap);

      const manual = manualOverrides.has(entry.key);
      // A hand-ticked clause counts for its full worth. Taking the max (rather
      // than adding) keeps the courses it already claimed from counting twice.
      if (manual && entry.cap !== null) {
        clauseEarned = Math.max(clauseEarned, entry.cap);
      }

      earnedCredits = round2(earnedCredits + clauseEarned);

      clauses[entry.key] = {
        status: manual ? "met" : statusOf(entry.req, matched, completed),
        earnedCredits: clauseEarned,
        requiredCredits: entry.cap,
        matchedCourses: claimed,
        manual,
      };
    }
  }

  const totalCredits = completion.totalCredits;
  const metClauses = Object.values(clauses).filter(
    (clause) => clause.status === "met",
  ).length;

  // Clause credits are read off the calendar text one clause at a time, so
  // they can add up to more than the program's stated total (an "including"
  // subset counted twice, a hand-ticked clause the courses also cover). Clause
  // figures stay as they are; the program total is clamped so progress never
  // exceeds the requirement.
  if (totalCredits !== null && earnedCredits > totalCredits) {
    earnedCredits = totalCredits;
  }

  return {
    totalCredits,
    earnedCredits,
    percent:
      totalCredits === null || totalCredits <= 0
        ? null
        : Math.min(100, Math.max(0, round2((earnedCredits / totalCredits) * 100))),
    clauses,
    metClauses,
    totalClauses,
  };
}
