import type { DegreeProgram, ProgramType } from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import {
  buildProgramIndex,
  countProgramsByType,
  filterPrograms,
} from "./filter";

function program(
  name: string,
  type: ProgramType,
  options: {
    code?: string | null;
    sections?: string[];
  } = {},
): DegreeProgram {
  const code = options.code === undefined ? "ASMAJ0001" : options.code;

  return {
    id: code ?? name,
    code,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    title: name,
    name,
    degree: "science",
    type,
    sections: options.sections ?? [],
    changed: "2026-01-01",
    url: "https://example.test",
    enrolmentRawHtml: null,
    completion: null,
    courseCodes: [],
  };
}

const PROGRAMS: DegreeProgram[] = [
  program("Computer Science Major", "major", {
    code: "ASMAJ1689",
    sections: ["Computer Science", "Data Science"],
  }),
  program("Computer Science Specialist", "specialist", { code: "ASSPE1689" }),
  program("Physics Minor", "minor", { code: "ASMIN0641" }),
  program("Ecology & Evolutionary Biology Specialist", "specialist", {
    code: "ASSPE1097",
  }),
  program("Statistics Major", "major", { code: "ASMAJ1255" }),
  program("Book and Media Studies Major", "major", { code: null }),
];

const INDEX = buildProgramIndex(PROGRAMS);

describe("filterPrograms", () => {
  it("lists everything in name order for an empty query", () => {
    const { matches, total } = filterPrograms(INDEX, "", "all", 50);

    expect(total).toBe(PROGRAMS.length);
    expect(matches[0]?.name).toBe("Book and Media Studies Major");
  });

  it("finds the CS major from initials plus a word prefix", () => {
    const { matches } = filterPrograms(INDEX, "cs maj", "all", 50);

    expect(matches[0]?.name).toBe("Computer Science Major");
  });

  it("ranks a name prefix above an incidental substring", () => {
    const { matches } = filterPrograms(INDEX, "comp", "all", 50);

    expect(matches.map((match) => match.name)).toEqual([
      "Computer Science Major",
      "Computer Science Specialist",
    ]);
  });

  it("matches acronyms built from name initials", () => {
    const { matches } = filterPrograms(INDEX, "eeb", "all", 50);

    expect(matches[0]?.name).toBe("Ecology & Evolutionary Biology Specialist");
  });

  it("matches on the post code", () => {
    const { matches, total } = filterPrograms(INDEX, "asmin0641", "all", 50);

    expect(total).toBe(1);
    expect(matches[0]?.name).toBe("Physics Minor");
  });

  it("matches on subject areas", () => {
    const { matches } = filterPrograms(INDEX, "data science", "all", 50);

    expect(matches.map((match) => match.name)).toEqual([
      "Computer Science Major",
    ]);
  });

  it("requires every token to match", () => {
    const { total } = filterPrograms(INDEX, "computer physics", "all", 50);

    expect(total).toBe(0);
  });

  it("narrows by type", () => {
    const { matches, total } = filterPrograms(INDEX, "computer", "specialist", 50);

    expect(total).toBe(1);
    expect(matches[0]?.name).toBe("Computer Science Specialist");
  });

  it("caps the rendered matches but reports the true total", () => {
    const { matches, total } = filterPrograms(INDEX, "", "all", 2);

    expect(matches).toHaveLength(2);
    expect(total).toBe(PROGRAMS.length);
  });

  it("tolerates programs with no post code", () => {
    const { matches } = filterPrograms(INDEX, "book", "all", 50);

    expect(matches[0]?.code).toBeNull();
  });
});

describe("countProgramsByType", () => {
  it("counts every program when the query is empty", () => {
    expect(countProgramsByType(INDEX, "")).toEqual({
      all: 6,
      specialist: 2,
      major: 3,
      minor: 1,
      focus: 0,
      certificate: 0,
    });
  });

  it("counts only matches for a query", () => {
    expect(countProgramsByType(INDEX, "computer")).toEqual({
      all: 2,
      specialist: 1,
      major: 1,
      minor: 0,
      focus: 0,
      certificate: 0,
    });
  });
});
