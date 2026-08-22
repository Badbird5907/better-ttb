import type { SectionCode } from "@better-ttb/shared";

import { isGroupNode, type ReqNode } from "@/lib/requisites/ast";
import { descendants, type RequisiteGraph } from "@/lib/requisites/graph";
import {
  evaluateReq,
  type CompletedCourses,
  type ReqStatus,
} from "@/lib/requisites/satisfies";

/**
 * Pure helpers behind {@link import("./course-path-view").CoursePathView}.
 *
 * The path view trades completeness for legibility: instead of rendering the
 * requisite AST verbatim (nested ALL OF / ONE OF badges), it flattens the top
 * level into a numbered checklist of independent requirements.
 */

// ---------------------------------------------------------------------------
// Requirement rows
// ---------------------------------------------------------------------------

export interface RequirementRow {
  /** Stable-enough key for React lists. */
  id: string;
  node: ReqNode;
}

/**
 * Flatten a prerequisite AST into reading-order rows.
 *
 * A top-level `and` becomes one row per child (that is the "checklist" shape:
 * every row must independently be satisfied). Nested `and`s one level down are
 * spliced in too, since `A and (B and C)` reads identically to `A, B, C`.
 * Anything else (a bare course, a single `or`, a credits blob) is a single row.
 */
export function flattenRequirementRows(root: ReqNode | null): RequirementRow[] {
  if (root === null) {
    return [];
  }

  const top = root.type === "and" ? root.children : [root];
  const flat: ReqNode[] = [];

  for (const child of top) {
    if (child.type === "and") {
      flat.push(...child.children);
    } else {
      flat.push(child);
    }
  }

  return flat.map((node, index) => ({ id: `${index}:${nodeKey(node)}`, node }));
}

function nodeKey(node: ReqNode): string {
  switch (node.type) {
    case "course":
      return node.code;
    case "credits":
      return node.raw.slice(0, 32);
    case "text":
      return node.text.slice(0, 32);
    default:
      return `${node.type}:${node.children.length}`;
  }
}

/** Inline label for a requirement row's alternatives ("One of", "2 of", …). */
export function rowLabel(node: ReqNode): string | null {
  if (node.type === "or") {
    return "One of";
  }

  if (node.type === "nOf") {
    return `${node.n} of`;
  }

  if (node.type === "and") {
    return "All of";
  }

  return null;
}

/** Children to render inline for a group row; `null` for leaf rows. */
export function rowOptions(node: ReqNode): ReqNode[] | null {
  return isGroupNode(node) ? node.children : null;
}

/**
 * True when a row is "unverified": its outcome cannot be checked against the
 * completed-course list (free text or a credit-count requirement).
 */
export function isUnverifiableNode(node: ReqNode): boolean {
  return node.type === "credits" || node.type === "text";
}

export function unverifiableText(node: ReqNode): string {
  if (node.type === "credits") {
    return node.raw;
  }

  if (node.type === "text") {
    return node.text;
  }

  return "";
}

/** Rows that are actually checkable, used for the "N requirements" summary. */
export function summarizeRows(
  rows: readonly RequirementRow[],
  completed: CompletedCourses,
): { total: number; satisfied: number; unverified: number } {
  let satisfied = 0;
  let unverified = 0;

  for (const row of rows) {
    if (isUnverifiableNode(row.node)) {
      unverified += 1;
      continue;
    }

    if (evaluateReq(row.node, completed) === "met") {
      satisfied += 1;
    }
  }

  return { total: rows.length, satisfied, unverified };
}

// ---------------------------------------------------------------------------
// Course code facts
// ---------------------------------------------------------------------------

const CREDIT_SUFFIX = /([HY])\d$/;
const LEVEL_PREFIX = /^[A-Z]{3,4}(\d)/;

/** Credit weight implied by the code suffix (H = 0.5, Y = 1.0). */
export function creditWeightFromCode(code: string): number | null {
  const match = CREDIT_SUFFIX.exec(code.trim().toUpperCase());
  const suffix = match?.[1];

  if (suffix === undefined) {
    return null;
  }

  return suffix === "Y" ? 1 : 0.5;
}

export function formatCreditWeight(weight: number): string {
  return `${weight.toFixed(1)} credit${weight === 1 ? "" : "s"}`;
}

/** Study level implied by the first digit (1–4), or `null` when unparseable. */
export function courseLevel(code: string): number | null {
  const match = LEVEL_PREFIX.exec(code.trim().toUpperCase());
  const digit = match?.[1];

  if (digit === undefined) {
    return null;
  }

  const level = Number.parseInt(digit, 10);

  return Number.isFinite(level) ? level : null;
}

export function levelLabel(level: number | null): string {
  return level === null ? "Other" : `${level}00-level`;
}

const SECTION_LABELS: Record<SectionCode, string> = {
  F: "Fall",
  S: "Winter",
  Y: "Full year",
};

export function sectionLabel(sectionCode: SectionCode | null): string | null {
  return sectionCode === null ? null : (SECTION_LABELS[sectionCode] ?? null);
}

// ---------------------------------------------------------------------------
// "After" zone
// ---------------------------------------------------------------------------

export type UnlockStatus =
  /** Already takeable with the current completed list. */
  | "ready"
  /** Becomes takeable once the focus course is done — the interesting case. */
  | "readyAfter"
  /** Needs the focus course *and* the rest of the current timetable. */
  | "readyAfterTerm"
  /** Still needs other courses. */
  | "blocked";

export interface UnlockedCourse {
  code: string;
  level: number | null;
  inCatalog: boolean;
  status: UnlockStatus;
}

const UNLOCK_RANK: Record<UnlockStatus, number> = {
  readyAfter: 0,
  readyAfterTerm: 1,
  ready: 2,
  blocked: 3,
};

/**
 * Direct dependents of `code` (courses listing it as a prerequisite), annotated
 * with whether finishing `code` is the last thing standing between the student
 * and that course.
 *
 * `inProgress` (the active timetable's pinned courses) adds one more tier: a
 * course that needs the focus course *and* something else you are already
 * taking this term is reported as `readyAfterTerm` rather than `blocked`.
 */
export function computeUnlockedCourses(
  graph: RequisiteGraph,
  code: string,
  completed: CompletedCourses,
  inProgress: readonly string[] = [],
): UnlockedCourse[] {
  const dependents = descendants(graph, code, {
    depth: 1,
    kinds: ["prereq"],
  });

  const withFocus: Record<string, number | null> = { ...completed };

  if (!Object.prototype.hasOwnProperty.call(withFocus, code)) {
    withFocus[code] = null;
  }

  const withTerm: Record<string, number | null> = { ...withFocus };

  for (const pinned of inProgress) {
    if (!Object.prototype.hasOwnProperty.call(withTerm, pinned)) {
      withTerm[pinned] = null;
    }
  }

  const hasTerm = Object.keys(withTerm).length > Object.keys(withFocus).length;

  const unlocked: UnlockedCourse[] = [];

  for (const dependent of dependents) {
    const node = graph.nodes.get(dependent);
    const root = node?.requisites.prereq?.root ?? null;
    const before: ReqStatus = evaluateReq(root, completed);
    const after: ReqStatus = evaluateReq(root, withFocus);

    unlocked.push({
      code: dependent,
      level: courseLevel(dependent),
      inCatalog: node?.inCatalog ?? false,
      status:
        before === "met"
          ? "ready"
          : after === "met"
            ? "readyAfter"
            : hasTerm && evaluateReq(root, withTerm) === "met"
              ? "readyAfterTerm"
              : "blocked",
    });
  }

  unlocked.sort((a, b) => {
    const rank = UNLOCK_RANK[a.status] - UNLOCK_RANK[b.status];

    if (rank !== 0) {
      return rank;
    }

    const level = (a.level ?? 9) - (b.level ?? 9);

    return level !== 0 ? level : a.code.localeCompare(b.code);
  });

  return unlocked;
}

export interface UnlockGroup {
  level: number | null;
  label: string;
  courses: UnlockedCourse[];
}

/** Group already-sorted unlocks by study level, preserving level order. */
export function groupUnlocksByLevel(
  unlocked: readonly UnlockedCourse[],
): UnlockGroup[] {
  const byLevel = new Map<number, UnlockedCourse[]>();
  const other: UnlockedCourse[] = [];

  for (const course of unlocked) {
    if (course.level === null) {
      other.push(course);
      continue;
    }

    const existing = byLevel.get(course.level);

    if (existing) {
      existing.push(course);
    } else {
      byLevel.set(course.level, [course]);
    }
  }

  const groups: UnlockGroup[] = [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, courses]) => ({
      level,
      label: levelLabel(level),
      courses,
    }));

  if (other.length > 0) {
    groups.push({ level: null, label: levelLabel(null), courses: other });
  }

  return groups;
}
