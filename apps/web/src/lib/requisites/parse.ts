import {
  collectCourseCodes,
  containsStructuralLeaf,
  containsTextLeaf,
  isGroupNode,
  isTextNode,
  type ParseConfidence,
  type ParsedRequisite,
  type ReqNode,
} from "./ast";

// UofT course codes: 3 or 4 letters, then 2-3 digits (UTSC/UTM 4-letter codes
// use 2 digits, e.g. CSCC69H3), a session length H/Y, and a campus digit.
const COURSE_CODE = /[A-Z]{3,4}\d{2,3}[HY]\d/g;

const cache = new Map<string, ParsedRequisite>();

export function parseRequisite(
  html: string | null | undefined,
): ParsedRequisite {
  const key = html ?? "\u0000__nullish__";
  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  const result = computeParsedRequisite(html);
  cache.set(key, result);
  return result;
}

function computeParsedRequisite(
  html: string | null | undefined,
): ParsedRequisite {
  const paragraphs = htmlToParagraphs(html);
  const strippedAll = paragraphs.map((p) => p.text).join(" ");

  try {
    if (paragraphs.every((p) => p.text.trim().length === 0)) {
      return { root: null, confidence: "full", notes: [], courseCodes: [] };
    }

    const notes: string[] = [];
    const primaryParagraphs: string[] = [];

    for (const paragraph of paragraphs) {
      const text = paragraph.text.trim();

      if (text.length === 0) {
        continue;
      }

      if (paragraph.isAudience) {
        notes.push(text);
        continue;
      }

      if (primaryParagraphs.length === 0) {
        primaryParagraphs.push(text);
      } else {
        // Subsequent non-audience paragraphs are usually "Note:" blocks.
        notes.push(text);
      }
    }

    const rawPrimary = primaryParagraphs[0] ?? "";
    const { primary, extractedNotes } = extractInlineNotes(rawPrimary);
    notes.push(...extractedNotes);

    const courseCodes = scanCourseCodes(strippedAll);
    const cleaned = primary.trim();

    if (cleaned.length === 0) {
      // Nothing structural to parse in the primary (e.g. it was all a Note).
      return {
        root: null,
        confidence: courseCodes.length > 0 ? "none" : "full",
        notes,
        courseCodes,
      };
    }

    const tokens = tokenize(cleaned);

    if (!bracketsBalanced(tokens)) {
      return {
        root: { type: "text", text: cleaned },
        confidence: "none",
        notes,
        courseCodes,
      };
    }

    const parser = new Parser(tokens);
    const parsedRoot = parser.parseSequence(false);
    const root = normalize(parsedRoot);
    const confidence = scoreConfidence(root);

    return { root, confidence, notes, courseCodes };
  } catch {
    const notes = collectNotesOnError(paragraphs);
    const trimmed = strippedAll.trim();
    return {
      root: trimmed.length > 0 ? { type: "text", text: trimmed } : null,
      confidence: "none",
      notes,
      courseCodes: scanCourseCodes(strippedAll),
    };
  }
}

function collectNotesOnError(paragraphs: Paragraph[]): string[] {
  const notes: string[] = [];
  let seenPrimary = false;

  for (const paragraph of paragraphs) {
    const text = paragraph.text.trim();

    if (text.length === 0) {
      continue;
    }

    if (paragraph.isAudience) {
      notes.push(text);
      continue;
    }

    if (!seenPrimary) {
      seenPrimary = true;
      continue;
    }

    notes.push(text);
  }

  return notes;
}

// ---------------------------------------------------------------------------
// HTML handling
// ---------------------------------------------------------------------------

interface Paragraph {
  text: string;
  isAudience: boolean;
}

const AUDIENCE_HEADER =
  /^(prerequisite|corequisite|exclusion|recommended\s+preparation)s?\s+for\s+.+?students?:/i;

function htmlToParagraphs(html: string | null | undefined): Paragraph[] {
  if (html === null || html === undefined) {
    return [];
  }

  const source = String(html);
  const hasParagraphs = /<p\b/i.test(source);
  let chunks: string[];

  if (hasParagraphs) {
    chunks = source
      .split(/<\/p\s*>|<p\b[^>]*>/i)
      .filter((chunk) => chunk.trim().length > 0);
  } else {
    chunks = [source];
  }

  return chunks.map((chunk) => {
    const startsAudienceMarkup = /^\s*<strong\b[^>]*>[^<]*students?\s*:/i.test(
      chunk,
    );
    const text = stripTags(chunk);
    const isAudience = startsAudienceMarkup || AUDIENCE_HEADER.test(text.trim());
    return { text, isAudience };
  });
}

function stripTags(chunk: string): string {
  return decodeEntities(
    chunk
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

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

      return named[normalized] ?? entity;
    },
  );
}

function codePoint(value: number, fallback: string): string {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

/**
 * Regex-only course-code extraction over entity-decoded, tag-stripped text.
 * Used for exclusions and as a fallback when full parsing is not needed.
 */
export function extractCourseCodes(html: string | null | undefined): string[] {
  if (html === null || html === undefined) {
    return [];
  }

  const stripped = htmlToParagraphs(html)
    .map((paragraph) => paragraph.text)
    .join(" ");
  return scanCourseCodes(stripped);
}

function scanCourseCodes(text: string): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(COURSE_CODE)) {
    const code = match[0];

    if (!seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }

  return codes;
}

// ---------------------------------------------------------------------------
// Note extraction from the primary paragraph
// ---------------------------------------------------------------------------

function extractInlineNotes(paragraph: string): {
  primary: string;
  extractedNotes: string[];
} {
  const extractedNotes: string[] = [];
  const match = paragraph.match(/\b(Notes?|NOTE)\s*:/);

  if (!match || match.index === undefined) {
    return { primary: paragraph, extractedNotes };
  }

  const note = paragraph
    .slice(match.index)
    .trim()
    .replace(/\.\s*$/, "");
  extractedNotes.push(note);
  const primary = paragraph.slice(0, match.index).trim();
  return { primary, extractedNotes };
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { kind: "course"; code: string; minGrade?: number }
  | { kind: "credits"; raw: string }
  | { kind: "text"; text: string }
  | { kind: "op"; value: ";" | "," | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "nOf"; n: number }
  | { kind: "anyOf" };

const QUANTIFIER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let textBuffer: string[] = [];

  const flushText = (): void => {
    const text = textBuffer.join(" ").replace(/\s+/g, " ").trim();
    // Skip punctuation-only runs (e.g. a trailing ".") so they never become
    // text leaves that would wrongly downgrade parse confidence.
    if (text.length > 0 && /[a-z0-9]/i.test(text)) {
      tokens.push({ kind: "text", text });
    }
    textBuffer = [];
  };

  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === "(" || ch === "[") {
      flushText();
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }

    if (ch === ")" || ch === "]") {
      flushText();
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }

    if (ch === "/" || ch === "," || ch === ";") {
      flushText();
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }

    const rest = input.slice(i);

    // Prefix grade: "60% or higher in CSC148H1"
    const prefixGrade = rest.match(
      /^(\d{1,3})\s*%\s+or\s+(?:higher|better|more)\s+in\s+([A-Z]{3,4}\d{2,3}[HY]\d)/i,
    );
    if (prefixGrade) {
      flushText();
      tokens.push({
        kind: "course",
        code: prefixGrade[2]!,
        minGrade: Number.parseInt(prefixGrade[1]!, 10),
      });
      i += prefixGrade[0].length;
      continue;
    }

    // Course code (optionally followed by grade suffix)
    const courseMatch = rest.match(/^[A-Z]{3,4}\d{2,3}[HY]\d/);
    if (courseMatch) {
      flushText();
      const code = courseMatch[0];
      let consumed = code.length;
      let minGrade: number | undefined;

      const gradeSuffix = rest.slice(consumed).match(/^\s*\(\s*(\d{1,3})\s*%\s*\)/);
      if (gradeSuffix) {
        minGrade = Number.parseInt(gradeSuffix[1]!, 10);
        consumed += gradeSuffix[0].length;
      }

      tokens.push(
        minGrade === undefined
          ? { kind: "course", code }
          : { kind: "course", code, minGrade },
      );
      i += consumed;
      continue;
    }

    // Credit leaf: number + credit(s) + qualifier up to next top-level operator.
    if (/^\d+(?:\.\d+)?\s*credits?\b/i.test(rest)) {
      flushText();
      const raw = consumeCreditLeaf(rest);
      tokens.push({ kind: "credits", raw: raw.trim() });
      i += raw.length;
      continue;
    }

    // "any of the following:" marker
    const anyOf = rest.match(
      /^(?:from\s+)?any(?:\s+one)?\s+of(?:\s+the\s+following)?\s*:?/i,
    );
    if (anyOf) {
      flushText();
      tokens.push({ kind: "anyOf" });
      i += anyOf[0].length;
      continue;
    }

    // Quantifier: "two of", "one of", "2 of"
    const quantifier = rest.match(/^(one|two|three|four|1|2|3|4)\s+of\b/i);
    if (quantifier) {
      const n = QUANTIFIER_WORDS[quantifier[1]!.toLowerCase()];

      if (n !== undefined) {
        flushText();
        tokens.push({ kind: "nOf", n });
        i += quantifier[0].length;
        continue;
      }
    }

    // Otherwise accumulate a word into the text buffer.
    const word = rest.match(/^[^\s/,;()[\]]+/);
    if (word) {
      textBuffer.push(word[0]);
      i += word[0].length;
    } else {
      i += 1;
    }
  }

  flushText();
  return tokens;
}

// Marker phrases that introduce an OR list (e.g. "from any of the following:").
// A credit leaf must stop before one so the list parses as its own OR group.
const ANY_OF_MARKER = /^\s*(?:from\s+)?any(?:\s+one)?\s+of(?:\s+the\s+following)?\s*:?/i;

/**
 * Consume a credit leaf starting at the beginning of `rest`: the credits phrase
 * plus its trailing qualifier up to the next top-level operator (`;`, `/`, a
 * comma that does NOT introduce a nested "including ..." clause, or an "any of
 * the following" marker that hands the remaining list to the parser).
 */
function consumeCreditLeaf(rest: string): string {
  let depth = 0;
  const head = rest.match(/^\d+(?:\.\d+)?\s*credits?\b/i);
  let i = head ? head[0].length : 0;

  while (i < rest.length) {
    const ch = rest[i];

    if (ch === "(" || ch === "[") {
      depth += 1;
    } else if (ch === ")" || ch === "]") {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    } else if (depth === 0 && (ch === ";" || ch === "/")) {
      break;
    } else if (depth === 0 && ANY_OF_MARKER.test(rest.slice(i))) {
      break;
    } else if (depth === 0 && ch === ",") {
      if (/^\s*including\b/i.test(rest.slice(i + 1))) {
        i += 1;
        continue;
      }
      break;
    }

    i += 1;
  }

  return rest.slice(0, i);
}

function bracketsBalanced(tokens: Token[]): boolean {
  let depth = 0;

  for (const token of tokens) {
    if (token.kind === "lparen") {
      depth += 1;
    } else if (token.kind === "rparen") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }

  return depth === 0;
}

// ---------------------------------------------------------------------------
// Recursive-descent parser
// ---------------------------------------------------------------------------

class Parser {
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

  private atSegmentEnd(): boolean {
    const token = this.peek();
    if (token === undefined || token.kind === "rparen") {
      return true;
    }
    return token.kind === "op" && token.value === ";";
  }

  /** A sequence separated by `;` (AND). */
  parseSequence(_insideGroup: boolean): ReqNode {
    const parts: ReqNode[] = [this.parseCommaList()];

    while (this.peek()?.kind === "op" && (this.peek() as { value: string }).value === ";") {
      this.next();
      parts.push(this.parseCommaList());
    }

    return parts.length === 1 ? parts[0]! : { type: "and", children: parts };
  }

  /**
   * A comma-separated list. Commas mean AND unless an "any of the following"
   * marker at this level switches them to OR. An `nOf` marker consumes the
   * remainder of the comma list as its children.
   */
  private parseCommaList(): ReqNode {
    let orMode = false;
    const parts: ReqNode[] = [];

    // A leading "any of the following" flips the whole list to OR.
    if (this.peek()?.kind === "anyOf") {
      this.next();
      orMode = true;
    }

    while (!this.atSegmentEnd()) {
      const token = this.peek();

      if (token?.kind === "nOf") {
        this.next();
        parts.push(this.parseNOf(token.n));
        continue;
      }

      if (token?.kind === "anyOf") {
        this.next();
        if (parts.length === 0) {
          // No preceding content: the whole list is the OR options.
          orMode = true;
          continue;
        }
        // Preceding content (e.g. a credits leaf): the following list is a
        // self-contained OR group ANDed with what came before.
        parts.push(this.parseOrList());
        continue;
      }

      parts.push(this.parseOr());

      const sep = this.peek();
      if (sep?.kind === "op" && sep.value === ",") {
        this.next();
      }
      // Otherwise fall through: adjacent items with no comma separator (e.g.
      // "1.0 credit from any of the following: A, B") continue the same list.
      // Punctuation-only runs are dropped by the tokenizer, so trailing "."
      // does not leak in as a spurious text leaf here.
    }

    if (parts.length === 1) {
      return parts[0]!;
    }

    return { type: orMode ? "or" : "and", children: parts };
  }

  /**
   * Parse the remainder of the current segment as an OR of comma/`/`-separated
   * options (used after a mid-list "any of the following" marker).
   */
  private parseOrList(): ReqNode {
    const options: ReqNode[] = [];

    while (!this.atSegmentEnd()) {
      options.push(this.parseOr());

      const sep = this.peek();
      if (sep?.kind === "op" && sep.value === ",") {
        this.next();
        continue;
      }
      break;
    }

    return options.length === 1
      ? options[0]!
      : { type: "or", children: options };
  }

  /**
   * `nOf`: consumes a comma-separated list (each element may be an OR of
   * `/`-joined items) until the segment ends (rparen, `;`, or end of input).
   */
  private parseNOf(n: number): ReqNode {
    const children: ReqNode[] = [];

    while (!this.atSegmentEnd()) {
      children.push(this.parseOr());

      const sep = this.peek();
      if (sep?.kind === "op" && sep.value === ",") {
        this.next();
        continue;
      }
      break;
    }

    return { type: "nOf", n, children };
  }

  /** An OR chain joined by `/`. */
  private parseOr(): ReqNode {
    const parts: ReqNode[] = [this.parsePrimary()];

    while (this.peek()?.kind === "op" && (this.peek() as { value: string }).value === "/") {
      this.next();
      parts.push(this.parsePrimary());
    }

    return parts.length === 1 ? parts[0]! : { type: "or", children: parts };
  }

  private parsePrimary(): ReqNode {
    const token = this.next();

    if (token === undefined) {
      return { type: "text", text: "" };
    }

    if (token.kind === "lparen") {
      const inner = this.parseSequence(true);
      if (this.peek()?.kind === "rparen") {
        this.next();
      }
      return inner;
    }

    if (token.kind === "course") {
      return token.minGrade === undefined
        ? { type: "course", code: token.code }
        : { type: "course", code: token.code, minGrade: token.minGrade };
    }

    if (token.kind === "credits") {
      return { type: "credits", raw: token.raw };
    }

    if (token.kind === "text") {
      return { type: "text", text: token.text };
    }

    if (token.kind === "nOf") {
      return this.parseNOf(token.n);
    }

    // Stray anyOf / operator / rparen: empty text leaf (dropped on normalize).
    return { type: "text", text: "" };
  }
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

function normalize(node: ReqNode): ReqNode {
  if (!isGroupNode(node)) {
    return node;
  }

  let children = node.children
    .map(normalize)
    .filter((child) => !(isTextNode(child) && child.text.trim().length === 0));

  if (node.type === "and" || node.type === "or") {
    const flattened: ReqNode[] = [];
    for (const child of children) {
      if (child.type === node.type) {
        flattened.push(...child.children);
      } else {
        flattened.push(child);
      }
    }
    children = flattened;
  }

  children = dedupe(children);

  if (node.type === "nOf") {
    return { type: "nOf", n: node.n, children };
  }

  if (children.length === 1) {
    return children[0]!;
  }

  if (children.length === 0) {
    return { type: "text", text: "" };
  }

  return { type: node.type, children };
}

function dedupe(children: ReqNode[]): ReqNode[] {
  const seen = new Set<string>();
  const result: ReqNode[] = [];

  for (const child of children) {
    const key = leafKey(child);
    if (key !== null) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    result.push(child);
  }

  return result;
}

function leafKey(node: ReqNode): string | null {
  if (node.type === "course") {
    return `course:${node.code}:${node.minGrade ?? ""}`;
  }
  if (node.type === "credits") {
    return `credits:${node.raw}`;
  }
  if (node.type === "text") {
    return `text:${node.text}`;
  }
  return null;
}

function scoreConfidence(root: ReqNode): ParseConfidence {
  if (isTextNode(root)) {
    return "none";
  }

  const hasStructural = containsStructuralLeaf(root);
  const hasText = containsTextLeaf(root);

  if (!hasStructural) {
    return "none";
  }

  return hasText ? "partial" : "full";
}

export { collectCourseCodes };
