import type { ProgramProgress } from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import {
  pendingInProgressCodes,
  projectProgramProgress,
  unionCreditWeights,
} from "./projection";

function progress(overrides: Partial<ProgramProgress>): ProgramProgress {
  return {
    totalCredits: 8,
    earnedCredits: 0,
    percent: 0,
    clauses: {},
    metClauses: 0,
    totalClauses: 0,
    ...overrides,
  };
}

describe("unionCreditWeights", () => {
  it("adds in-progress codes as null weights without overwriting completed entries", () => {
    const union = unionCreditWeights({ CSC108H1: 0.5 }, ["CSC108H1", "CSC148H1"]);

    expect(union).toEqual({ CSC108H1: 0.5, CSC148H1: null });
  });

  it("does not mutate the completed map", () => {
    const completed = { CSC108H1: null };
    unionCreditWeights(completed, ["MAT137Y1"]);

    expect(completed).toEqual({ CSC108H1: null });
  });
});

describe("pendingInProgressCodes", () => {
  it("filters out codes already completed", () => {
    expect(
      pendingInProgressCodes({ CSC108H1: null }, ["CSC108H1", "CSC148H1"]),
    ).toEqual(["CSC148H1"]);
  });
});

describe("projectProgramProgress", () => {
  it("collapses onto completed figures when nothing is in progress", () => {
    const result = projectProgramProgress(
      progress({ earnedCredits: 2, percent: 25 }),
      null,
    );

    expect(result).toEqual({
      earnedCredits: 2,
      inProgressCredits: 0,
      percent: 25,
      projectedPercent: 25,
    });
  });

  it("reports the in-progress delta and projected percent", () => {
    const result = projectProgramProgress(
      progress({ earnedCredits: 2, percent: 25 }),
      progress({ earnedCredits: 3.5, percent: 43.75 }),
    );

    expect(result).toEqual({
      earnedCredits: 2,
      inProgressCredits: 1.5,
      percent: 25,
      projectedPercent: 43.75,
    });
  });

  it("never reports a negative delta", () => {
    const result = projectProgramProgress(
      progress({ earnedCredits: 8, percent: 100 }),
      progress({ earnedCredits: 8, percent: 100 }),
    );

    expect(result.inProgressCredits).toBe(0);
  });
});
