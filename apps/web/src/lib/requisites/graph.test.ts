import type { Course, CourseInfo, SectionCode } from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import {
  ancestors,
  buildRequisiteGraph,
  collectCourseLeaves,
  descendants,
} from "./graph";
import { parseRequisite } from "./parse";

interface FakeCourseOptions {
  code: string;
  sectionCode?: SectionCode;
  prerequisitesText?: string | null;
  corequisitesText?: string | null;
  recommendedPreparation?: string | null;
  exclusionsText?: string | null;
}

function makeCourse(options: FakeCourseOptions): Course {
  const info: CourseInfo = {
    description: null,
    prerequisitesText: options.prerequisitesText ?? null,
    corequisitesText: options.corequisitesText ?? null,
    exclusionsText: options.exclusionsText ?? null,
    recommendedPreparation: options.recommendedPreparation ?? null,
    levelOfInstruction: "",
    breadthRequirements: [],
    distributionRequirements: [],
    division: "",
  };

  return {
    code: options.code,
    sectionCode: options.sectionCode ?? "F",
    cmCourseInfo: info,
  } as unknown as Course;
}

describe("buildRequisiteGraph", () => {
  it("creates prereq edges pointing from requirement to dependent", () => {
    const graph = buildRequisiteGraph([
      makeCourse({ code: "CSC148H1" }),
      makeCourse({ code: "CSC207H1", prerequisitesText: "<p>CSC148H1</p>" }),
    ]);

    const incoming = graph.edgesTo.get("CSC207H1") ?? [];
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({
      from: "CSC148H1",
      to: "CSC207H1",
      kind: "prereq",
    });

    // X enables C: outgoing edge from the requirement to the dependent.
    const outgoing = graph.edgesFrom.get("CSC148H1") ?? [];
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]?.to).toBe("CSC207H1");
  });

  it("prefers the F offering info over S for the parsed course", () => {
    const graph = buildRequisiteGraph([
      makeCourse({
        code: "CSC207H1",
        sectionCode: "S",
        prerequisitesText: "<p>CSC148H1</p>",
      }),
      makeCourse({
        code: "CSC207H1",
        sectionCode: "F",
        prerequisitesText: "<p>CSC108H1</p>",
      }),
    ]);

    const node = graph.nodes.get("CSC207H1");
    expect(node?.offerings).toHaveLength(2);
    expect(node?.inCatalog).toBe(true);

    // Edges come from the preferred (F) offering only.
    const incoming = graph.edgesTo.get("CSC207H1") ?? [];
    expect(incoming.map((edge) => edge.from)).toEqual(["CSC108H1"]);
  });

  it("distinguishes coreq from prereq edge kinds", () => {
    const graph = buildRequisiteGraph([
      makeCourse({
        code: "CSC207H1",
        prerequisitesText: "<p>CSC148H1</p>",
        corequisitesText: "<p>MAT137Y1</p>",
      }),
    ]);

    const incoming = graph.edgesTo.get("CSC207H1") ?? [];
    const byKind = Object.fromEntries(
      incoming.map((edge) => [edge.from, edge.kind]),
    );
    expect(byKind).toEqual({ CSC148H1: "prereq", MAT137Y1: "coreq" });
  });

  it("dedupes edges by from+to+kind keeping a defined minGrade", () => {
    const graph = buildRequisiteGraph([
      makeCourse({
        code: "MAT223H1",
        prerequisitesText: "<p>MAT137Y1/ MAT137Y1(70%)</p>",
      }),
    ]);

    const incoming = graph.edgesTo.get("MAT223H1") ?? [];
    const mat137 = incoming.filter((edge) => edge.from === "MAT137Y1");
    expect(mat137).toHaveLength(1);
    expect(mat137[0]?.minGrade).toBe(70);
  });

  it("creates out-of-catalog nodes for referenced-only codes", () => {
    const graph = buildRequisiteGraph([
      makeCourse({ code: "CSC207H1", prerequisitesText: "<p>CSC148H1</p>" }),
    ]);

    const csc148 = graph.nodes.get("CSC148H1");
    expect(csc148).toBeDefined();
    expect(csc148?.inCatalog).toBe(false);
    expect(csc148?.offerings).toEqual([]);
    expect(csc148?.requisites).toEqual({
      prereq: null,
      coreq: null,
      recprep: null,
    });

    const csc207 = graph.nodes.get("CSC207H1");
    expect(csc207?.inCatalog).toBe(true);

    // Edge still exists in both directions.
    expect(graph.edgesTo.get("CSC207H1")?.[0]?.from).toBe("CSC148H1");
    expect(graph.edgesFrom.get("CSC148H1")?.[0]?.to).toBe("CSC207H1");
  });

  it("limits ancestor and descendant traversal by depth", () => {
    const graph = buildRequisiteGraph([
      makeCourse({ code: "AAA100H1" }),
      makeCourse({ code: "BBB100H1", prerequisitesText: "<p>AAA100H1</p>" }),
      makeCourse({ code: "CCC100H1", prerequisitesText: "<p>BBB100H1</p>" }),
    ]);

    expect(ancestors(graph, "CCC100H1", { depth: 1 })).toEqual(
      new Set(["BBB100H1"]),
    );
    // Unlimited depth (no depth option) walks the full chain.
    expect(ancestors(graph, "CCC100H1")).toEqual(
      new Set(["BBB100H1", "AAA100H1"]),
    );

    expect(descendants(graph, "AAA100H1", { depth: 1 })).toEqual(
      new Set(["BBB100H1"]),
    );
    expect(descendants(graph, "AAA100H1")).toEqual(
      new Set(["BBB100H1", "CCC100H1"]),
    );
  });

  it("terminates on cycles (A requires B, B coreq A)", () => {
    const graph = buildRequisiteGraph([
      makeCourse({ code: "AAA100H1", prerequisitesText: "<p>BBB100H1</p>" }),
      makeCourse({ code: "BBB100H1", corequisitesText: "<p>AAA100H1</p>" }),
    ]);

    expect(ancestors(graph, "AAA100H1")).toEqual(new Set(["BBB100H1"]));
    expect(ancestors(graph, "BBB100H1")).toEqual(new Set(["AAA100H1"]));
  });

  it("filters traversal by edge kind", () => {
    const graph = buildRequisiteGraph([
      makeCourse({ code: "AAA100H1" }),
      makeCourse({ code: "XXX100H1" }),
      makeCourse({
        code: "CCC100H1",
        prerequisitesText: "<p>AAA100H1</p>",
        corequisitesText: "<p>XXX100H1</p>",
      }),
    ]);

    expect(ancestors(graph, "CCC100H1", { kinds: ["prereq"] })).toEqual(
      new Set(["AAA100H1"]),
    );
    expect(ancestors(graph, "CCC100H1")).toEqual(
      new Set(["AAA100H1", "XXX100H1"]),
    );
  });

  it("falls back to primary courseCodes for confidence-none prereqs", () => {
    // Unbalanced brackets force confidence "none"; edges must still be built
    // from the flat courseCodes scan for better recall.
    const graph = buildRequisiteGraph([
      makeCourse({
        code: "ZZZ400H1",
        prerequisitesText: "<p>AAA100H1/ (BBB200H1</p>",
      }),
    ]);

    expect(graph.nodes.get("ZZZ400H1")?.requisites.prereq?.confidence).toBe(
      "none",
    );
    expect(
      new Set(graph.edgesTo.get("ZZZ400H1")?.map((edge) => edge.from)),
    ).toEqual(new Set(["AAA100H1", "BBB200H1"]));
  });

  it("excludes note-only codes from confidence-none edge fallback", () => {
    // Unbalanced primary => confidence "none"; the Note code must NOT become an
    // edge even though it appears in the overall courseCodes list.
    const graph = buildRequisiteGraph([
      makeCourse({
        code: "ZZZ400H1",
        prerequisitesText:
          "<p>AAA100H1/ (BBB200H1. Note: CCC300H1 is recommended.</p>",
      }),
    ]);

    expect(graph.nodes.get("ZZZ400H1")?.requisites.prereq?.confidence).toBe(
      "none",
    );
    const froms = graph.edgesTo.get("ZZZ400H1")?.map((edge) => edge.from) ?? [];
    expect(froms).toContain("AAA100H1");
    expect(froms).toContain("BBB200H1");
    expect(froms).not.toContain("CCC300H1");
  });

  it("records flat exclusion codes on the node", () => {
    const graph = buildRequisiteGraph([
      makeCourse({
        code: "CSC369H1",
        exclusionsText: "<p>CSC369H5, CSCC69H3</p>",
      }),
    ]);

    expect(graph.nodes.get("CSC369H1")?.exclusions).toEqual([
      "CSC369H5",
      "CSCC69H3",
    ]);
  });
});

describe("collectCourseLeaves", () => {
  it("returns deduped course leaves with minGrade", () => {
    const parsed = parseRequisite("MAT137Y1(70%)/ MAT137Y1/ CSC148H1");
    const leaves = collectCourseLeaves(parsed.root);

    expect(leaves).toEqual([
      { code: "MAT137Y1", minGrade: 70 },
      { code: "CSC148H1" },
    ]);
  });

  it("returns an empty list for a null root", () => {
    expect(collectCourseLeaves(null)).toEqual([]);
  });
});
