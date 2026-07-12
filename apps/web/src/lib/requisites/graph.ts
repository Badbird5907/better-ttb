import type { Course, SectionCode } from "@better-ttb/shared";

import {
  isCourseNode,
  isGroupNode,
  type ParsedRequisite,
  type ReqNode,
} from "./ast";
import { extractCourseCodes, parseRequisite } from "./parse";

export type EdgeKind = "prereq" | "coreq" | "recprep";

export interface ReqEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  minGrade?: number;
}

export interface GraphNode {
  code: string;
  /** All catalog offerings for this bare code. */
  offerings: Course[];
  /** false = referenced only (e.g. UTM/UTSC/engineering codes). */
  inCatalog: boolean;
  /** Parsed requisites from the preferred offering (F > S > Y). */
  requisites: Record<EdgeKind, ParsedRequisite | null>;
  /** Flat code list parsed from exclusionsText. */
  exclusions: string[];
}

export interface RequisiteGraph {
  nodes: Map<string, GraphNode>;
  /** Outgoing: this course enables / leads-to others. */
  edgesFrom: Map<string, ReqEdge[]>;
  /** Incoming: the requirements of this course. */
  edgesTo: Map<string, ReqEdge[]>;
}

export interface TraversalOptions {
  depth?: number;
  kinds?: EdgeKind[];
}

const ALL_KINDS: EdgeKind[] = ["prereq", "coreq", "recprep"];

const SECTION_CODE_RANK: Record<SectionCode, number> = {
  F: 0,
  S: 1,
  Y: 2,
};

export function buildRequisiteGraph(
  courses: readonly Course[],
): RequisiteGraph {
  const offeringsByCode = new Map<string, Course[]>();

  for (const course of courses) {
    const code = course.code;

    if (!code) {
      continue;
    }

    const existing = offeringsByCode.get(code);

    if (existing) {
      existing.push(course);
    } else {
      offeringsByCode.set(code, [course]);
    }
  }

  const nodes = new Map<string, GraphNode>();
  const edgesFrom = new Map<string, ReqEdge[]>();
  const edgesTo = new Map<string, ReqEdge[]>();
  const edgeKeys = new Set<string>();

  const addEdge = (edge: ReqEdge): void => {
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.kind}`;

    if (edgeKeys.has(key)) {
      // Dedupe by from+to+kind; upgrade to keep a defined minGrade.
      if (edge.minGrade !== undefined) {
        replaceEdge(edgesFrom, edge.from, edge);
        replaceEdge(edgesTo, edge.to, edge);
      }
      return;
    }

    edgeKeys.add(key);
    pushEdge(edgesFrom, edge.from, edge);
    pushEdge(edgesTo, edge.to, edge);
  };

  const ensureNode = (code: string): GraphNode => {
    const existing = nodes.get(code);

    if (existing) {
      return existing;
    }

    // Referenced-but-missing placeholder; may be upgraded below.
    const node: GraphNode = {
      code,
      offerings: [],
      inCatalog: false,
      requisites: { prereq: null, coreq: null, recprep: null },
      exclusions: [],
    };
    nodes.set(code, node);
    return node;
  };

  // First pass: create in-catalog nodes with parsed requisites.
  for (const [code, offerings] of offeringsByCode) {
    const preferred = pickPreferredOffering(offerings);
    const info = preferred?.cmCourseInfo ?? null;

    const node = ensureNode(code);
    node.offerings = offerings;
    node.inCatalog = true;
    node.requisites = {
      prereq: parseRequisite(info?.prerequisitesText),
      coreq: parseRequisite(info?.corequisitesText),
      recprep: parseRequisite(info?.recommendedPreparation),
    };
    node.exclusions = extractCourseCodes(info?.exclusionsText);
  }

  // Second pass: build edges (so out-of-catalog placeholders can be created
  // without being mistaken for in-catalog courses during the first pass).
  for (const [code, node] of [...nodes]) {
    if (!node.inCatalog) {
      continue;
    }

    for (const kind of ALL_KINDS) {
      const parsed = node.requisites[kind];

      if (!parsed) {
        continue;
      }

      for (const dependency of edgeDependencies(parsed)) {
        if (dependency.code === code) {
          // Self-references occur in prose; never edge a course to itself.
          continue;
        }

        ensureNode(dependency.code);

        const edge: ReqEdge = { from: dependency.code, to: code, kind };

        if (dependency.minGrade !== undefined) {
          edge.minGrade = dependency.minGrade;
        }

        addEdge(edge);
      }
    }
  }

  return { nodes, edgesFrom, edgesTo };
}

/** Transitive requirements of `code` (courses it depends on). */
export function ancestors(
  graph: RequisiteGraph,
  code: string,
  opts: TraversalOptions = {},
): Set<string> {
  return traverse(graph.edgesTo, code, opts, (edge) => edge.from);
}

/** Courses that (transitively) require `code`. */
export function descendants(
  graph: RequisiteGraph,
  code: string,
  opts: TraversalOptions = {},
): Set<string> {
  return traverse(graph.edgesFrom, code, opts, (edge) => edge.to);
}

export function collectCourseLeaves(
  node: ReqNode | null,
): Array<{ code: string; minGrade?: number }> {
  const leaves: Array<{ code: string; minGrade?: number }> = [];
  const byCode = new Map<string, { code: string; minGrade?: number }>();

  const walk = (current: ReqNode): void => {
    if (isCourseNode(current)) {
      const existing = byCode.get(current.code);

      if (existing) {
        // Dedupe by code, keeping the strongest minGrade constraint.
        if (existing.minGrade === undefined && current.minGrade !== undefined) {
          existing.minGrade = current.minGrade;
        }
        return;
      }

      const leaf: { code: string; minGrade?: number } =
        current.minGrade === undefined
          ? { code: current.code }
          : { code: current.code, minGrade: current.minGrade };

      byCode.set(current.code, leaf);
      leaves.push(leaf);
      return;
    }

    if (isGroupNode(current)) {
      current.children.forEach(walk);
    }
  };

  if (node) {
    walk(node);
  }

  return leaves;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Course dependencies used for edges. For confident parses we use the AST
 * course leaves (carrying minGrade). When confidence is "none" we fall back to
 * the flat `courseCodes` scan for better recall.
 */
function edgeDependencies(
  parsed: ParsedRequisite,
): Array<{ code: string; minGrade?: number }> {
  if (parsed.confidence === "none") {
    return collectPrimaryCodes(parsed).map((code) => ({ code }));
  }

  return collectCourseLeaves(parsed.root);
}

/**
 * Codes referenced by the primary requirement only (excludes note-only codes),
 * used as an edge fallback for unparseable prose.
 */
function collectPrimaryCodes(parsed: ParsedRequisite): string[] {
  const noteCodes = new Set<string>();

  for (const note of parsed.notes) {
    for (const match of note.matchAll(/[A-Z]{3,4}\d{2,3}[HY]\d/g)) {
      noteCodes.add(match[0]);
    }
  }

  return parsed.courseCodes.filter((code) => !noteCodes.has(code));
}

function pushEdge(
  map: Map<string, ReqEdge[]>,
  key: string,
  edge: ReqEdge,
): void {
  const existing = map.get(key);

  if (existing) {
    existing.push(edge);
  } else {
    map.set(key, [edge]);
  }
}

function replaceEdge(
  map: Map<string, ReqEdge[]>,
  key: string,
  edge: ReqEdge,
): void {
  const existing = map.get(key);

  if (!existing) {
    map.set(key, [edge]);
    return;
  }

  const index = existing.findIndex(
    (candidate) =>
      candidate.from === edge.from &&
      candidate.to === edge.to &&
      candidate.kind === edge.kind,
  );

  if (index === -1) {
    existing.push(edge);
  } else {
    existing[index] = edge;
  }
}

function pickPreferredOffering(offerings: readonly Course[]): Course | null {
  let best: Course | null = null;

  for (const offering of offerings) {
    if (best === null || sectionRank(offering.sectionCode) < sectionRank(best.sectionCode)) {
      best = offering;
    }
  }

  return best;
}

function sectionRank(sectionCode: SectionCode): number {
  return SECTION_CODE_RANK[sectionCode] ?? Number.MAX_SAFE_INTEGER;
}

function traverse(
  map: Map<string, ReqEdge[]>,
  start: string,
  opts: TraversalOptions,
  pick: (edge: ReqEdge) => string,
): Set<string> {
  const maxDepth = opts.depth ?? Number.POSITIVE_INFINITY;
  const kinds = new Set(opts.kinds ?? ALL_KINDS);
  const result = new Set<string>();
  const visited = new Set<string>([start]);
  let frontier: string[] = [start];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    const nextFrontier: string[] = [];

    for (const code of frontier) {
      const edges = map.get(code) ?? [];

      for (const edge of edges) {
        if (!kinds.has(edge.kind)) {
          continue;
        }

        const neighbor = pick(edge);

        if (visited.has(neighbor)) {
          continue;
        }

        visited.add(neighbor);
        result.add(neighbor);
        nextFrontier.push(neighbor);
      }
    }

    frontier = nextFrontier;
    depth += 1;
  }

  return result;
}
