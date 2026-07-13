import { describe, expect, it } from "vitest";

import type { ReqNode } from "./ast";
import { courseStatus, evaluateReq, type CompletedCourses } from "./satisfies";

const completed: CompletedCourses = {
  CSC108H1: null,
  CSC148H1: 85,
  CSC165H1: 60,
  MAT137Y1: 72,
};

function course(code: string, minGrade?: number): ReqNode {
  return minGrade === undefined
    ? { type: "course", code }
    : { type: "course", code, minGrade };
}

describe("courseStatus", () => {
  it("treats missing courses as unmet", () => {
    expect(courseStatus("CSC207H1", undefined, completed)).toBe("unmet");
  });

  it("treats taken courses without a minimum grade as met", () => {
    expect(courseStatus("CSC108H1", undefined, completed)).toBe("met");
  });

  it("checks minimum grades when a grade is known", () => {
    expect(courseStatus("CSC148H1", 80, completed)).toBe("met");
    expect(courseStatus("CSC165H1", 70, completed)).toBe("unmet");
  });

  it("returns unknown when a minimum grade needs an unknown grade", () => {
    expect(courseStatus("CSC108H1", 60, completed)).toBe("unknown");
  });
});

describe("evaluateReq", () => {
  it("returns unknown for null, text, and credits leaves", () => {
    expect(evaluateReq(null, completed)).toBe("unknown");
    expect(evaluateReq({ type: "text", text: "Permission required" }, completed)).toBe(
      "unknown",
    );
    expect(evaluateReq({ type: "credits", raw: "1.0 credit in CSC" }, completed)).toBe(
      "unknown",
    );
  });

  it("evaluates AND groups with unknown propagation", () => {
    expect(
      evaluateReq(
        { type: "and", children: [course("CSC148H1"), course("MAT137Y1", 70)] },
        completed,
      ),
    ).toBe("met");

    expect(
      evaluateReq(
        {
          type: "and",
          children: [course("CSC148H1"), { type: "text", text: "Interview" }],
        },
        completed,
      ),
    ).toBe("unknown");

    expect(
      evaluateReq(
        {
          type: "and",
          children: [course("CSC148H1"), course("CSC207H1")],
        },
        completed,
      ),
    ).toBe("unmet");
  });

  it("evaluates OR groups with unknown propagation", () => {
    expect(
      evaluateReq(
        { type: "or", children: [course("CSC207H1"), course("CSC148H1")] },
        completed,
      ),
    ).toBe("met");

    expect(
      evaluateReq(
        {
          type: "or",
          children: [course("CSC207H1"), course("MAT223H1")],
        },
        completed,
      ),
    ).toBe("unmet");

    expect(
      evaluateReq(
        {
          type: "or",
          children: [
            course("CSC207H1"),
            { type: "credits", raw: "1.0 credit in CSC" },
          ],
        },
        completed,
      ),
    ).toBe("unknown");
  });

  it("evaluates N OF groups with unknown propagation", () => {
    expect(
      evaluateReq(
        {
          type: "nOf",
          n: 2,
          children: [course("CSC148H1"), course("MAT137Y1"), course("CSC207H1")],
        },
        completed,
      ),
    ).toBe("met");

    expect(
      evaluateReq(
        {
          type: "nOf",
          n: 2,
          children: [
            course("CSC148H1"),
            course("CSC207H1"),
            { type: "text", text: "Equivalent experience" },
          ],
        },
        completed,
      ),
    ).toBe("unknown");

    expect(
      evaluateReq(
        {
          type: "nOf",
          n: 3,
          children: [
            course("CSC148H1"),
            course("CSC207H1"),
            { type: "credits", raw: "1.0 credit in CSC" },
          ],
        },
        completed,
      ),
    ).toBe("unmet");
  });
});
