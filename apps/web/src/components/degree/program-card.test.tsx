import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DegreeProgram } from "@better-ttb/shared";
import { evaluateProgram, parseCompletionRequirements } from "@better-ttb/shared";

import { creditWeightsFromCompleted } from "@/components/completed-courses/utils";
import { ProgramProgressSummary } from "./program-card";

const link = (code: string): string => `<a href='/course/${code}'>${code}</a>`;

const program: DegreeProgram = {
  id: "TEST0001",
  code: "TEST0001",
  slug: "test",
  title: "Test Program",
  name: "Test Program",
  degree: null,
  type: "major",
  sections: [],
  changed: "2026-01-01T00:00:00+00:00",
  url: "https://example.invalid/program/test",
  enrolmentRawHtml: null,
  completion: parseCompletionRequirements(
    `<p>(4.0 credits)</p> <p>1. ${link("PHL200Y1")}</p>`,
  ),
  courseCodes: [],
};

/**
 * The completed-courses store holds grades; `evaluateProgram` reads numbers as
 * credit weights. The two maps have the same shape, so the conversion at the
 * seam is the only thing keeping a graded course from counting as 78 credits.
 */
describe("creditWeightsFromCompleted", () => {
  it("drops grades so courses are weighed by their code", () => {
    expect(creditWeightsFromCompleted({ PHL200Y1: 78, CSC108H1: null })).toEqual({
      PHL200Y1: null,
      CSC108H1: null,
    });
  });

  it("keeps program progress identical whether or not a grade is recorded", () => {
    const graded = evaluateProgram(
      program,
      creditWeightsFromCompleted({ PHL200Y1: 78 }),
      new Set(),
    );
    const ungraded = evaluateProgram(
      program,
      creditWeightsFromCompleted({ PHL200Y1: null }),
      new Set(),
    );

    expect(graded.earnedCredits).toBe(1);
    expect(graded.percent).toBe(25);
    expect(graded).toEqual(ungraded);
  });

  it("guards the regression: raw grades inflate progress to 100%", () => {
    const raw = evaluateProgram(program, { PHL200Y1: 78 }, new Set());

    expect(raw.earnedCredits).toBe(4);
    expect(raw.percent).toBe(100);
  });
});

describe("ProgramProgressSummary", () => {
  const props = {
    earnedCredits: 0,
    totalCredits: 4,
    percent: 0,
    metClauses: 0,
    totalClauses: 3,
  };

  it("reports met requirements and a progress bar for a parsed program", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProgramProgressSummary, props),
    );

    expect(html).toContain("0/3 requirements met");
    expect(html).toContain('role="progressbar"');
  });

  it("reports nothing countable when the requirements could not be parsed", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProgramProgressSummary, { ...props, parsed: false }),
    );

    // No "0/3 requirements met" beside requirements we never parsed.
    expect(html).not.toContain("requirements met");
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain("4.0");
  });
});
