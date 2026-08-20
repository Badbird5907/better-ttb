import type { DegreeProgram, ProgramType } from "@better-ttb/shared";

/**
 * Client-side search over the 411 calendar programs.
 *
 * The whole catalogue is in memory, so this is a plain scored scan rather than
 * an index — it runs per keystroke, so the scoring is deliberately cheap (a
 * handful of `startsWith`/`includes` over pre-lowercased strings).
 */

export const PROGRAM_TYPES = [
  "specialist",
  "major",
  "minor",
  "focus",
  "certificate",
] as const satisfies readonly ProgramType[];

export type ProgramTypeFilter = ProgramType | "all";

export interface ProgramSearchEntry {
  program: DegreeProgram;
  /** Lowercased display name. */
  name: string;
  /** Lowercased post code, or "" when the program has none. */
  code: string;
  /** Lowercased subject areas, joined. */
  sections: string;
  /** Lowercased name words, for word-prefix matching. */
  words: string[];
  /** First letter of each name word, e.g. "Computer Science Major" -> "csm". */
  initials: string;
}

const WORD_SPLIT = /[^a-z0-9]+/;

/** Precomputes the lowercased haystacks. Do this once per catalogue load. */
export function buildProgramIndex(
  programs: readonly DegreeProgram[],
): ProgramSearchEntry[] {
  return programs.map((program) => {
    const name = program.name.toLowerCase();
    const words = name.split(WORD_SPLIT).filter((word) => word.length > 0);

    return {
      program,
      name,
      code: (program.code ?? "").toLowerCase(),
      sections: program.sections.join(" ").toLowerCase(),
      words,
      initials: words.map((word) => word[0] ?? "").join(""),
    };
  });
}

const NO_MATCH = Number.POSITIVE_INFINITY;

/**
 * Lower is better. The tiers are ordered so that the thing a student typed a
 * prefix of ("cs maj", "phy") outranks an incidental substring hit.
 */
function scoreToken(entry: ProgramSearchEntry, token: string): number {
  if (entry.name.startsWith(token)) return 0;
  if (entry.initials.startsWith(token)) return 1;
  if (entry.words.some((word) => word.startsWith(token))) return 2;
  if (entry.code.startsWith(token)) return 3;
  if (entry.code.includes(token)) return 4;
  if (entry.name.includes(token)) return 5;
  if (entry.sections.includes(token)) return 6;
  return NO_MATCH;
}

/** Sum of per-token scores; `NO_MATCH` when any token misses everywhere. */
export function scoreProgram(
  entry: ProgramSearchEntry,
  tokens: readonly string[],
): number {
  let total = 0;

  for (const token of tokens) {
    const score = scoreToken(entry, token);

    if (score === NO_MATCH) {
      return NO_MATCH;
    }

    total += score;
  }

  return total;
}

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(WORD_SPLIT)
    .filter((token) => token.length > 0);
}

export interface ProgramFilterResult {
  /** Up to `limit` best matches. */
  matches: DegreeProgram[];
  /** How many programs matched in total, before the limit. */
  total: number;
}

/**
 * Filters by type, then by query. An empty query lists everything (name order);
 * otherwise every whitespace-separated token must match somewhere.
 */
export function filterPrograms(
  index: readonly ProgramSearchEntry[],
  query: string,
  type: ProgramTypeFilter,
  limit: number,
): ProgramFilterResult {
  const tokens = tokenizeQuery(query);
  const scored: { entry: ProgramSearchEntry; score: number }[] = [];

  for (const entry of index) {
    if (type !== "all" && entry.program.type !== type) {
      continue;
    }

    const score = tokens.length === 0 ? 0 : scoreProgram(entry, tokens);

    if (score === NO_MATCH) {
      continue;
    }

    scored.push({ entry, score });
  }

  scored.sort(
    (left, right) =>
      left.score - right.score || left.entry.name.localeCompare(right.entry.name),
  );

  return {
    matches: scored.slice(0, limit).map((item) => item.entry.program),
    total: scored.length,
  };
}

/** Counts per type for the filter pills (respecting the current query). */
export function countProgramsByType(
  index: readonly ProgramSearchEntry[],
  query: string,
): Record<ProgramTypeFilter, number> {
  const tokens = tokenizeQuery(query);
  const counts: Record<ProgramTypeFilter, number> = {
    all: 0,
    specialist: 0,
    major: 0,
    minor: 0,
    focus: 0,
    certificate: 0,
  };

  for (const entry of index) {
    if (tokens.length > 0 && scoreProgram(entry, tokens) === NO_MATCH) {
      continue;
    }

    counts.all += 1;
    counts[entry.program.type] += 1;
  }

  return counts;
}
