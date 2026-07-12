import { describe, expect, it } from "vitest";

import {
  collectCourseCodes,
  isGroupNode,
  type ReqNode,
} from "./ast";
import { extractCourseCodes, parseRequisite } from "./parse";

function courseLeaves(node: ReqNode | null): Extract<ReqNode, { type: "course" }>[] {
  const leaves: Extract<ReqNode, { type: "course" }>[] = [];

  const walk = (current: ReqNode): void => {
    if (current.type === "course") {
      leaves.push(current);
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

function findNode(
  node: ReqNode | null,
  predicate: (candidate: ReqNode) => boolean,
): ReqNode | null {
  if (!node) {
    return null;
  }

  if (predicate(node)) {
    return node;
  }

  if (isGroupNode(node)) {
    for (const child of node.children) {
      const found = findNode(child, predicate);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

describe("parseRequisite", () => {
  it("parses a course OR free-text fallback as partial", () => {
    const result = parseRequisite("<p>CSC108H1/ (equivalent programming experience)</p>");

    expect(result.root?.type).toBe("or");
    expect(result.confidence).toBe("partial");

    const or = result.root as Extract<ReqNode, { type: "or" }>;
    expect(or.children.some((child) => child.type === "course")).toBe(true);
    expect(or.children.some((child) => child.type === "text")).toBe(true);
    expect(courseLeaves(result.root)[0]?.code).toBe("CSC108H1");
  });

  it("parses OR of two courses plus text without HTML", () => {
    const result = parseRequisite(
      "CSC108H1/CSC120H1/(equivalent programming experience)",
    );

    expect(result.root?.type).toBe("or");
    const codes = courseLeaves(result.root).map((leaf) => leaf.code);
    expect(codes).toEqual(["CSC108H1", "CSC120H1"]);

    const or = result.root as Extract<ReqNode, { type: "or" }>;
    expect(or.children.some((child) => child.type === "text")).toBe(true);
  });

  it("treats empty, null and undefined as no requirement", () => {
    for (const input of ["", null, undefined]) {
      const result = parseRequisite(input);
      expect(result.root).toBeNull();
      expect(result.confidence).toBe("full");
      expect(result.notes).toEqual([]);
      expect(result.courseCodes).toEqual([]);
    }
  });

  it("parses prefix grade form into course nodes with minGrade", () => {
    const result = parseRequisite(
      "<p>60% or higher in CSC148H1/ 60% or higher in CSC148H5/ 60% or higher in CSCA48H3/ 60% or higher in CSC111H1</p>",
    );

    expect(result.root?.type).toBe("or");
    const leaves = courseLeaves(result.root);
    expect(leaves).toHaveLength(4);
    expect(leaves.every((leaf) => leaf.minGrade === 60)).toBe(true);
    expect(leaves.map((leaf) => leaf.code)).toEqual([
      "CSC148H1",
      "CSC148H5",
      "CSCA48H3",
      "CSC111H1",
    ]);
  });

  it("parses nested grouped prefix grades", () => {
    const result = parseRequisite(
      "<p>(60% or higher in CSC148H1/ 60% or higher in CSC148H5/ 60% or higher in CSCA48H3; 60% or higher in CSC165H1/ 60% or higher in MAT102H5/ 60% or higher in CSCA67H3/ 60% or higher in MATA67H3)/ 60% or higher in CSC111H1.</p>",
    );

    expect(result.confidence).toBe("full");
    expect(result.root?.type).toBe("or");

    const or = result.root as Extract<ReqNode, { type: "or" }>;
    // One branch is the AND group, the other is CSC111H1.
    expect(or.children.some((child) => child.type === "and")).toBe(true);
    expect(
      or.children.some(
        (child) => child.type === "course" && child.code === "CSC111H1",
      ),
    ).toBe(true);

    const leaves = courseLeaves(result.root);
    expect(leaves.every((leaf) => leaf.minGrade === 60)).toBe(true);
  });

  it("parses AND of two OR groups", () => {
    const result = parseRequisite(
      "CSC209H1/ CSC209H5/ CSCB09H3; CSC258H1/ CSC258H5/ CSCB58H3",
    );

    expect(result.root?.type).toBe("and");
    const and = result.root as Extract<ReqNode, { type: "and" }>;
    expect(and.children).toHaveLength(2);
    expect(and.children.every((child) => child.type === "or")).toBe(true);
  });

  it("parses the MAT237Y1 nested monster without error", () => {
    const result = parseRequisite(
      "<p>[MAT133Y1/ (MAT135H1, MAT136H1)/ (MAT135H5, MAT136H5)/ (MATA30H3/ MATA31H3, MATA36H3), MAT138H1/ MAT102H5/ MAT246H1]/ MAT137Y1/ MAT137Y5/ (MAT137H5, MAT139H5)/ (MATA30H3/ MATA31H3, MATA37H3)/ MAT157Y1/ MAT157Y5/ (MAT157H5, MAT159H5), MAT223H1/ MATA22H3/ MATA23H3/ MAT240H1/ MAT240H5</p>",
    );

    expect(result.confidence).toBe("full");
    expect(result.root?.type).toBe("and");
    expect(result.courseCodes).toContain("MAT133Y1");
    expect(result.courseCodes).toContain("MAT240H5");
  });

  it("parses grade suffix form with minGrade", () => {
    const result = parseRequisite(
      "MAT221H1(80%)/MAT223H1/MAT223H5/ MATA22H3/ MATA23H3/ MAT240H1/MAT240H5",
    );

    expect(result.root?.type).toBe("or");
    const mat221 = courseLeaves(result.root).find((leaf) => leaf.code === "MAT221H1");
    expect(mat221?.minGrade).toBe(80);
  });

  it("parses the ECO/MAT grade group monster", () => {
    const result = parseRequisite(
      "<p>(ECO101H1(63%), ECO102H1(63%))/ ECO105Y1(80%)/ ECO100Y5(67%)/ (ECO101H5(63%), ECO102H5(63%))/ (MGEA02H3 (67%), MGEA06H3 (67%)); MAT133Y1/ (MAT130H1/ MAT135H1, MAT136H1)/ MAT137Y1/ MAT157Y1</p>",
    );

    expect(result.root?.type).toBe("and");
    const and = result.root as Extract<ReqNode, { type: "and" }>;
    expect(and.children).toHaveLength(2);
    expect(and.children.every((child) => child.type === "or")).toBe(true);

    const mgea02 = courseLeaves(result.root).find((leaf) => leaf.code === "MGEA02H3");
    expect(mgea02?.minGrade).toBe(67);
  });

  it("parses single credits leaves as full confidence", () => {
    const single = parseRequisite("<p>0.5 credit in CSC</p>");
    expect(single.root?.type).toBe("credits");
    expect(single.confidence).toBe("full");

    const level = parseRequisite("<p>1.5 credits of 300+ level CSC courses.</p>");
    expect(level.root?.type).toBe("credits");
    expect(level.confidence).toBe("full");
  });

  it("captures a trailing Note while keeping the credits leaf", () => {
    const result = parseRequisite(
      "<p>14.0 credits including 1.5 credits in 300+ level CSC courses.</p> <p>Note: individual projects may have additional prerequisite requirements set by the supervising faculty member.</p>",
    );

    expect(result.root?.type).toBe("credits");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toContain("individual projects");
  });

  it("falls back to non-full confidence for prose requirements", () => {
    const calculus = parseRequisite("High school level calculus");
    expect(calculus.confidence).toBe("none");

    const env = parseRequisite(
      "10.0 credits, including 3.0 ENV credits in the student's environmental program completed before ENV440H1 is taken, and an application.",
    );
    expect(env.confidence).not.toBe("full");
  });

  it("parses the AST425Y1 two-of quantifier list", () => {
    const result = parseRequisite(
      "<p>AST320H1, two of AST325H1/ AST326Y1, PHY324H1, PHY350H1, PHY354H1, PHY356H1, PHY357H1, PHY358H1, PHY407H1/ PHY408H1, PHY450H1, JPE395H1</p>",
    );

    const nOf = findNode(result.root, (node) => node.type === "nOf") as
      | Extract<ReqNode, { type: "nOf" }>
      | null;
    expect(nOf?.n).toBe(2);
    expect(result.courseCodes).toContain("JPE395H1");
  });

  it("parses CSC384H1 with notes and an engineering audience paragraph", () => {
    const result = parseRequisite(
      '<p>CSC263H1/ CSC265H1/ CSC263H5/ CSCB63H3, STA237H1/ STA247H1/ STA255H1/ STA257H1/ STAB57H3/ STAB52H3. Notes: students enrolled in ASMAJ1446A who have completed at least 9.0 credits may substitute CSC111H1/ (CSC148H1, CSC165H1/ (MAT148H1, MAT149H1)/ MAT137Y1) for CSC263H1 and STA220H1/ PSY201H1 for STA237H1.</p> <p><strong>Prerequisite for Applied Science and Engineering students:</strong> <a href="https://engineering.calendar.utoronto.ca/course/ECE345H1">ECE345H1</a>/ <a href="https://engineering.calendar.utoronto.ca/course/ECE358H1">ECE358H1</a>, <a href="https://engineering.calendar.utoronto.ca/course/MIE236H1">MIE236H1</a></p>',
    );

    expect(result.root?.type).toBe("and");
    const and = result.root as Extract<ReqNode, { type: "and" }>;
    expect(and.children).toHaveLength(2);
    expect(and.children.every((child) => child.type === "or")).toBe(true);

    expect(result.notes).toHaveLength(2);
    expect(result.courseCodes).toContain("ECE345H1");
    expect(result.courseCodes).toContain("CSC111H1");
  });

  it("parses PSL300H1 with credits relating to an OR list", () => {
    const result = parseRequisite(
      "<p>BIO130H1; CHM136H1/ CHM151Y1; and 1.0 credit from any of the following: MAT135H1, MAT136H1, MAT137Y1, MAT157Y1, PHY131H1, PHY132H1, PHY151H1, PHY152H1</p>",
    );

    expect(result.root?.type).toBe("and");

    // The 8 "following" courses should appear under an OR, never an AND of all 8.
    const followingCodes = [
      "MAT135H1",
      "MAT136H1",
      "MAT137Y1",
      "MAT157Y1",
      "PHY131H1",
      "PHY132H1",
      "PHY151H1",
      "PHY152H1",
    ];
    const or = findNode(result.root, (node) => {
      if (node.type !== "or") {
        return false;
      }

      const codes = courseLeaves(node).map((leaf) => leaf.code);
      return followingCodes.every((code) => codes.includes(code));
    });

    expect(or).not.toBeNull();
    followingCodes.forEach((code) => expect(result.courseCodes).toContain(code));
  });

  it("extracts exclusion codes and captures a NOTE with entity decoding", () => {
    const html =
      "<p><span><span>CSC369H5, CSCC69H3. </span></span>NOTE: Students not enrolled in the Computer Science Major or Specialist program at A&amp;S, UTM, or UTSC... are limited to a maximum of 1.5 credits in 300-/400-level CSC/ECE courses.</p>";

    expect(extractCourseCodes(html)).toEqual(["CSC369H5", "CSCC69H3"]);

    const result = parseRequisite(html);
    expect(result.notes.length).toBeGreaterThanOrEqual(1);
    expect(result.notes.join(" ")).toContain("A&S");
  });

  it("handles malformed and garbage input safely", () => {
    const unbalanced = parseRequisite("<p>CSC108H1/ (CSC148H1");
    expect(unbalanced.confidence).toBe("none");
    expect(unbalanced.courseCodes).toEqual(["CSC108H1", "CSC148H1"]);

    const garbage = parseRequisite("<div><<<>>>");
    expect(garbage.courseCodes).toEqual([]);
    expect(() => parseRequisite("<div><<<>>>")).not.toThrow();
  });

  it("memoizes identical input", () => {
    const input = "<p>CSC108H1</p>";
    expect(parseRequisite(input)).toBe(parseRequisite(input));
  });

  it("collects course codes from the AST via helper", () => {
    const result = parseRequisite("CSC108H1/ CSC148H1");
    expect(collectCourseCodes(result.root)).toEqual(["CSC108H1", "CSC148H1"]);
  });
});
