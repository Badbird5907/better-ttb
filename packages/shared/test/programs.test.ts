import { describe, expect, it } from "vitest";

import {
  courseCreditWeight,
  courseLevel,
  courseSubject,
  evaluateProgram,
  inferProgramType,
  parseCompletionRequirements,
  parseProgramCode,
  parseProgramTitle,
  programClauseKey,
} from "../src";
import type {
  DegreeProgram,
  ProgramCompletion,
  ProgramReq,
} from "../src";

// ---------------------------------------------------------------------------
// Fixtures — abridged from the real calendar HTML.
// ---------------------------------------------------------------------------

const link = (code: string): string => `<a href='/course/${code}'>${code}</a>`;
/** The calendar separates OR alternatives with "/" + a zero-width space. */
const OR = "/&#8203; ";

const PHILOSOPHY_MINOR = [
  `<p>(4.0 credits, including ${link("PHL100Y1")}${OR}${link("PHL101Y1")} if taken)</p>`,
  `<p>1. 1.0 credit from the following: ${link("PHL200Y1")}${OR}${link("PHL205H1")}${OR}${link("PHL275H1")}`,
  `<br />2. Additional philosophy courses, to a total of 4.0 credits, including 1.0 credit at the 300+ level.</p>`,
].join(" ");

const CS_MAJOR_FIRST_YEAR = [
  `<p>(8.0 credits, including at least one 0.5 credit at the 400-level)</p>`,
  `<p><em>First year</em> (2.5 credits):<br />1. (${link("CSC108H1")}, ${link("CSC148H1")}, ${link("CSC165H1")}${OR}${link("CSC240H1")})/ (${link("CSC110Y1")}, ${link("CSC111H1")}); (${link("MAT148H1")}, ${link("MAT149H1")})/ ${link("MAT137Y1")}</p>`,
  `<p>Notes:</p>`,
  `<ol style="list-style-type: lower-alpha;"><li>Students with a strong background may omit ${link("CSC108H1")}.</li></ol>`,
  `<p><em>Second year</em> (2.5 credits):</p>`,
  `<p>2. ${link("CSC207H1")}, ${link("CSC236H1")}${OR}${link("CSC240H1")}</p>`,
].join(" ");

const GROUPED_CHOICE = [
  `<p>(3.0 credits)</p>`,
  `<p>1. 3.0 credits of courses in total selected from among the following groups:</p>`,
  `<ul><li><strong>Group A: </strong>Any 300-/ 400-level CSC course <em>except </em>${link("CSC369H1")}, and those listed in Group B</li></ul>`,
  `<ul><li><strong>Group B: </strong>${link("CSC299H1")}, ${link("CSC490H1")}</li></ul>`,
].join(" ");

const only = <T>(values: T[]): T => {
  expect(values).toHaveLength(1);
  return values[0]!;
};

const clausesOf = (completion: ProgramCompletion) =>
  completion.sections.flatMap((section) => section.clauses);

// ---------------------------------------------------------------------------
// Code / title helpers
// ---------------------------------------------------------------------------

describe("courseCreditWeight", () => {
  it("reads the session-length letter", () => {
    expect(courseCreditWeight("CSC108H1")).toBe(0.5);
    expect(courseCreditWeight("CSC110Y1")).toBe(1);
    expect(courseCreditWeight("CSC396Y0")).toBe(1);
  });

  it("handles four-letter UTSC codes", () => {
    expect(courseCreditWeight("CSCC69H3")).toBe(0.5);
  });

  it("returns null for non-course strings", () => {
    expect(courseCreditWeight("ASMAJ1689")).toBeNull();
    expect(courseCreditWeight("CSC108")).toBeNull();
    expect(courseCreditWeight("")).toBeNull();
  });
});

describe("courseSubject / courseLevel", () => {
  it("splits a code into subject and level", () => {
    expect(courseSubject("CSC373H1")).toBe("CSC");
    expect(courseLevel("CSC373H1")).toBe(300);
    expect(courseLevel("CSC108H1")).toBe(100);
    expect(courseLevel("CSC490H1")).toBe(400);
  });

  it("returns null for malformed codes", () => {
    expect(courseSubject("nope")).toBeNull();
    expect(courseLevel("nope")).toBeNull();
  });
});

describe("parseProgramCode", () => {
  it("parses standard post codes", () => {
    expect(parseProgramCode("ASMAJ1689")).toMatchObject({
      code: "ASMAJ1689",
      prefix: "MAJ",
      number: "1689",
      stream: null,
      type: "major",
    });
  });

  it("trims trailing whitespace from the calendar value", () => {
    expect(parseProgramCode("ASSPE1053 ")?.code).toBe("ASSPE1053");
  });

  it("keeps stream suffix letters", () => {
    expect(parseProgramCode("ASMAJ1445C")).toMatchObject({
      code: "ASMAJ1445C",
      stream: "C",
      type: "major",
    });
  });

  it("accepts an internal space after AS", () => {
    expect(parseProgramCode("AS FOC1689")?.type).toBe("focus");
  });

  it("rejects values that are really program names", () => {
    expect(parseProgramCode("Focus in Green Chemistry")).toBeNull();
    expect(parseProgramCode("AS CHRM")).toBeNull();
    expect(parseProgramCode(null)).toBeNull();
  });

  it("maps every known prefix", () => {
    expect(parseProgramCode("ASSPE1689")?.type).toBe("specialist");
    expect(parseProgramCode("ASMIN0231")?.type).toBe("minor");
    expect(parseProgramCode("ASFOC1689G")?.type).toBe("focus");
    expect(parseProgramCode("ASCER1000")?.type).toBe("certificate");
  });
});

describe("inferProgramType", () => {
  it("reads the type out of a title or slug", () => {
    expect(inferProgramType("Biological Physics Specialist")).toBe("specialist");
    expect(inferProgramType("focus in green chemistry")).toBe("focus");
    expect(inferProgramType("Certificate in Human Resource Management")).toBe(
      "certificate",
    );
    expect(inferProgramType("Nothing useful here")).toBeNull();
  });

  it("prefers the most specific match", () => {
    // "Specialist" wins over the "Major" mentioned in a stream name.
    expect(inferProgramType("Data Science Specialist (Major stream)")).toBe(
      "specialist",
    );
  });
});

describe("parseProgramTitle", () => {
  it("strips the trailing code and lifts the degree parenthetical", () => {
    expect(
      parseProgramTitle("Computer Science Major (Science Program) - ASMAJ1689"),
    ).toEqual({ name: "Computer Science Major", degree: "science" });
  });

  it("recognises arts programs", () => {
    expect(parseProgramTitle("Greek Minor (Arts Program) - ASMIN2123")).toEqual({
      name: "Greek Minor",
      degree: "arts",
    });
  });

  it("keeps non-degree parentheticals", () => {
    expect(
      parseProgramTitle(
        "Certificate in Human Resource Management (Category 1) - AS CHRM",
      ),
    ).toEqual({
      name: "Certificate in Human Resource Management (Category 1)",
      degree: null,
    });
  });

  it("handles uncoded programs whose suffix repeats the name", () => {
    expect(
      parseProgramTitle("Focus in Green Chemistry - Focus in Green Chemistry"),
    ).toEqual({ name: "Focus in Green Chemistry", degree: null });
  });
});

// ---------------------------------------------------------------------------
// Completion parser
// ---------------------------------------------------------------------------

describe("parseCompletionRequirements", () => {
  it("always keeps the raw html", () => {
    const completion = parseCompletionRequirements(PHILOSOPHY_MINOR);
    expect(completion.rawHtml).toBe(PHILOSOPHY_MINOR);
  });

  it("reads the total from the leading parenthetical and drops that line", () => {
    const completion = parseCompletionRequirements(PHILOSOPHY_MINOR);
    expect(completion.totalCredits).toBe(4);
    expect(clausesOf(completion)).toHaveLength(2);
  });

  it("falls back to a credit figure elsewhere in the text", () => {
    const completion = parseCompletionRequirements(
      `<p>Students complete 7.0 credits as follows.</p> <p>1. ${link("PHL200Y1")}</p>`,
    );
    expect(completion.totalCredits).toBe(7);
  });

  it("leaves the total null when no credit figure is present", () => {
    const completion = parseCompletionRequirements(
      `<p>1. ${link("PHL200Y1")}</p>`,
    );
    expect(completion.totalCredits).toBeNull();
  });

  it("splits numbered clauses that share a paragraph via <br>", () => {
    const clauses = clausesOf(parseCompletionRequirements(PHILOSOPHY_MINOR));
    expect(clauses.map((clause) => clause.index)).toEqual(["1", "2"]);
  });

  it("parses a credit-quantified choice list", () => {
    const clause = clausesOf(parseCompletionRequirements(PHILOSOPHY_MINOR))[0]!;
    expect(clause.req).toEqual({
      kind: "chooseCredits",
      credits: 1,
      from: [
        { kind: "course", code: "PHL200Y1" },
        { kind: "course", code: "PHL205H1" },
        { kind: "course", code: "PHL275H1" },
      ],
    });
    expect(clause.credits).toBe(1);
    expect(clause.advisory).toBe(false);
  });

  it("treats 'including' as a subset rather than an additional requirement", () => {
    const clause = clausesOf(parseCompletionRequirements(PHILOSOPHY_MINOR))[1]!;
    // "to a total of 4.0 credits, including 1.0 credit at the 300+ level"
    expect(clause.credits).toBe(4);
    const req = clause.req as Extract<ProgramReq, { kind: "allOf" }>;
    expect(req.kind).toBe("allOf");
    expect(req.items).toContainEqual(
      expect.objectContaining({ kind: "pool", credits: 1, minLevel: 300 }),
    );
  });

  it("strips zero-width spaces from clause text", () => {
    const clause = clausesOf(parseCompletionRequirements(PHILOSOPHY_MINOR))[0]!;
    expect(clause.text).not.toContain("​");
    expect(clause.text).toContain("PHL200Y1");
  });

  it("collects course codes per clause", () => {
    const clause = clausesOf(parseCompletionRequirements(PHILOSOPHY_MINOR))[0]!;
    expect(clause.courses).toEqual(["PHL200Y1", "PHL205H1", "PHL275H1"]);
  });

  it("also catches course codes that are not hyperlinked", () => {
    const completion = parseCompletionRequirements(
      `<p>1. ${link("CSC108H1")} or the UTM equivalent HIN211H5</p>`,
    );
    expect(clausesOf(completion)[0]!.courses).toEqual(["CSC108H1", "HIN211H5"]);
  });

  it("opens sections on <em> year headers and records their subtotals", () => {
    const completion = parseCompletionRequirements(CS_MAJOR_FIRST_YEAR);
    expect(
      completion.sections.map((section) => [section.label, section.credits]),
    ).toEqual([
      ["First year", 2.5],
      ["Second year", 2.5],
    ]);
  });

  it("parses grouped AND-pairs acting as one OR alternative", () => {
    const completion = parseCompletionRequirements(CS_MAJOR_FIRST_YEAR);
    const clause = completion.sections[0]!.clauses[0]!;
    const req = clause.req as Extract<ProgramReq, { kind: "allOf" }>;

    expect(req.kind).toBe("allOf");
    // (MAT148H1, MAT149H1)/MAT137Y1 -> OR of [AND-pair, MAT137Y1]
    const mat = req.items[1] as Extract<ProgramReq, { kind: "oneOf" }>;
    expect(mat.kind).toBe("oneOf");
    expect(mat.items).toContainEqual({ kind: "course", code: "MAT137Y1" });
    expect(mat.items[0]).toEqual({
      kind: "allOf",
      items: [
        { kind: "course", code: "MAT148H1" },
        { kind: "course", code: "MAT149H1" },
      ],
    });
  });

  it("sums course weights for an unambiguous AND clause", () => {
    const completion = parseCompletionRequirements(CS_MAJOR_FIRST_YEAR);
    // CSC207H1 (0.5) + (CSC236H1|CSC240H1) (0.5) = 1.0
    expect(completion.sections[1]!.clauses[0]!.credits).toBe(1);
  });

  it("marks lower-alpha list items as advisory", () => {
    const completion = parseCompletionRequirements(CS_MAJOR_FIRST_YEAR);
    const advisory = clausesOf(completion).filter((clause) => clause.advisory);
    expect(advisory.map((clause) => clause.text)).toContain(
      "Students with a strong background may omit CSC108H1 .",
    );
    expect(advisory.every((clause) => clause.req === null)).toBe(true);
  });

  it("marks Note paragraphs and consult-the-department prose as advisory", () => {
    const completion = parseCompletionRequirements(
      `<p>1. ${link("PHL200Y1")}</p> <p>Note: consult the department.</p> <p>Students are advised to take ${link("PHL205H1")}.</p>`,
    );
    const clauses = clausesOf(completion);
    expect(clauses.map((clause) => clause.advisory)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it("merges <ul> group bullets into the clause they follow", () => {
    const completion = parseCompletionRequirements(GROUPED_CHOICE);
    const clause = only(clausesOf(completion));

    expect(clause.index).toBe("1");
    expect(clause.credits).toBe(3);
    const req = clause.req as Extract<ProgramReq, { kind: "chooseCredits" }>;
    expect(req.kind).toBe("chooseCredits");
    expect(req.credits).toBe(3);
    expect(req.from).toContainEqual({ kind: "course", code: "CSC299H1" });
    expect(req.from).toContainEqual({ kind: "course", code: "CSC490H1" });
  });

  it("treats bullets after an 'either' lead-in as whole alternatives", () => {
    const completion = parseCompletionRequirements(
      [
        `<p>(4.0 credits)</p>`,
        `<p>1. Completion of either</p>`,
        `<ul style="list-style-type: circle;">`,
        `<li>${link("CSC108H1")}, ${link("CSC148H1")}, ${link("CSC165H1")} or </li>`,
        `<li>${link("CSC110Y1")}, ${link("CSC111H1")}</li>`,
        `</ul>`,
      ].join(" "),
    );
    const clause = only(clausesOf(completion));

    // The lead-in has no courses of its own; it must not stay advisory.
    expect(clause.advisory).toBe(false);
    expect(clause.req).toEqual({
      kind: "oneOf",
      items: [
        {
          kind: "allOf",
          items: [
            { kind: "course", code: "CSC108H1" },
            { kind: "course", code: "CSC148H1" },
            { kind: "course", code: "CSC165H1" },
          ],
        },
        {
          kind: "allOf",
          items: [
            { kind: "course", code: "CSC110Y1" },
            { kind: "course", code: "CSC111H1" },
          ],
        },
      ],
    });
  });

  it("keeps both the subject and the level of a qualified pool", () => {
    const completion = parseCompletionRequirements(
      `<p>1. 2.0 credits from CSC courses at the 200-/300-/400 level</p>`,
    );
    expect(only(clausesOf(completion)).req).toMatchObject({
      kind: "pool",
      credits: 2,
      subject: "CSC",
      levels: [200, 300, 400],
    });
  });

  it("parses a level pool with exclusions", () => {
    const completion = parseCompletionRequirements(GROUPED_CHOICE);
    const req = only(clausesOf(completion)).req as Extract<
      ProgramReq,
      { kind: "chooseCredits" }
    >;
    expect(req.from).toContainEqual(
      expect.objectContaining({
        kind: "pool",
        subject: "CSC",
        levels: [300, 400],
        excludes: ["CSC369H1"],
      }),
    );
  });

  it("understands 300+ level as an open-ended minimum", () => {
    const completion = parseCompletionRequirements(
      `<p>1. 1.0 credit at the 300+ level ECO</p>`,
    );
    expect(only(clausesOf(completion)).req).toEqual({
      kind: "pool",
      credits: 1,
      subject: "ECO",
      minLevel: 300,
      description: "at the 300+ level ECO",
    });
  });

  it("reports full confidence when every clause is structured", () => {
    expect(parseCompletionRequirements(PHILOSOPHY_MINOR).confidence).toBe(
      "full",
    );
    expect(parseCompletionRequirements(GROUPED_CHOICE).confidence).toBe("full");
  });

  it("reports partial confidence when some clauses stay as text", () => {
    const completion = parseCompletionRequirements(
      `<p>1. ${link("PHL200Y1")}</p> <p>2. 1.0 credit arranged with the graduate coordinator</p>`,
    );
    expect(completion.confidence).toBe("partial");
  });

  it("reports no confidence when nothing structured is found", () => {
    const completion = parseCompletionRequirements(
      `<p>1. 2.0 credits arranged individually with the program coordinator</p>`,
    );
    expect(completion.confidence).toBe("none");
  });

  it("does not throw on empty or junk input", () => {
    expect(parseCompletionRequirements("").sections).toEqual([]);
    expect(() => parseCompletionRequirements("<p>((( unbalanced</p>")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function programFrom(html: string): DegreeProgram {
  return {
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
    completion: parseCompletionRequirements(html),
    courseCodes: [],
  };
}

const completedSet = (...codes: string[]): Record<string, number | null> =>
  Object.fromEntries(codes.map((code) => [code, null]));

describe("evaluateProgram", () => {
  const program = programFrom(PHILOSOPHY_MINOR);

  it("marks a choose-credits clause met once the target is reached", () => {
    const progress = evaluateProgram(
      program,
      completedSet("PHL200Y1"), // Y = 1.0 credit
      new Set(),
    );
    const clause = progress.clauses[programClauseKey(0, 0)]!;
    expect(clause.status).toBe("met");
    expect(clause.earnedCredits).toBe(1);
    expect(clause.matchedCourses).toEqual(["PHL200Y1"]);
  });

  it("marks it partial when only some of the target is earned", () => {
    const progress = evaluateProgram(
      program,
      completedSet("PHL205H1"), // H = 0.5 of the required 1.0
      new Set(),
    );
    expect(progress.clauses[programClauseKey(0, 0)]!.status).toBe("partial");
  });

  it("marks it unmet when nothing matches", () => {
    const progress = evaluateProgram(program, completedSet("AST101H1"), new Set());
    expect(progress.clauses[programClauseKey(0, 0)]!.status).toBe("unmet");
  });

  it("never counts one course toward two clauses", () => {
    const progress = evaluateProgram(
      program,
      completedSet("PHL200Y1", "PHL301H1"),
      new Set(),
    );
    const first = progress.clauses[programClauseKey(0, 0)]!;
    const second = progress.clauses[programClauseKey(0, 1)]!;
    expect(first.matchedCourses).toEqual(["PHL200Y1"]);
    expect(second.matchedCourses).not.toContain("PHL200Y1");
    expect(progress.earnedCredits).toBe(1.5);
  });

  it("caps a clause's contribution at its stated credits", () => {
    const html = `<p>(4.0 credits)</p> <p>1. 1.0 credit from the following: ${link("PHL200Y1")}${OR}${link("PHL210Y1")}</p>`;
    const progress = evaluateProgram(
      programFrom(html),
      completedSet("PHL200Y1", "PHL210Y1"), // 2.0 credits offered, 1.0 required
      new Set(),
    );
    expect(progress.clauses[programClauseKey(0, 0)]!.earnedCredits).toBe(1);
    expect(progress.earnedCredits).toBe(1);
  });

  it("computes percent against the program total", () => {
    const progress = evaluateProgram(program, completedSet("PHL200Y1"), new Set());
    expect(progress.totalCredits).toBe(4);
    expect(progress.percent).toBe(25);
  });

  it("clamps percent to 100", () => {
    const progress = evaluateProgram(
      programFrom(
        `<p>(1.0 credit)</p> <p>1. 4.0 credits from the following: ${link("PHL200Y1")}${OR}${link("PHL210Y1")}</p>`,
      ),
      completedSet("PHL200Y1", "PHL210Y1"),
      new Set(),
    );
    expect(progress.percent).toBe(100);
  });

  it("clamps program credits when a clause over-claims", () => {
    // Two clauses that together account for more than the program is worth.
    const progress = evaluateProgram(
      programFrom(
        `<p>(1.0 credit)</p> <p>1. 1.0 credit at the 300+ level CSC<br />2. 1.0 credit at the 400+ level MAT</p>`,
      ),
      completedSet("CSC369H1", "CSC373H1", "MAT401H1", "MAT402H1"),
      new Set(),
    );
    expect(progress.earnedCredits).toBe(1);
    expect(progress.percent).toBe(100);
    // The clauses keep their exact figures.
    expect(progress.clauses[programClauseKey(0, 0)]!.earnedCredits).toBe(1);
    expect(progress.clauses[programClauseKey(0, 1)]!.earnedCredits).toBe(1);
  });

  it("returns a null percent when the total is unknown", () => {
    const progress = evaluateProgram(
      programFrom(`<p>1. ${link("PHL200Y1")}</p>`),
      completedSet("PHL200Y1"),
      new Set(),
    );
    expect(progress.totalCredits).toBeNull();
    expect(progress.percent).toBeNull();
  });

  it("honours explicit credit weights in the completed map", () => {
    const progress = evaluateProgram(
      programFrom(
        `<p>(4.0 credits)</p> <p>1. 1.0 credit from the following: ${link("PHL205H1")}${OR}${link("PHL275H1")}</p>`,
      ),
      { PHL205H1: 1 }, // an H course transferred in as a full credit
      new Set(),
    );
    expect(progress.clauses[programClauseKey(0, 0)]!.status).toBe("met");
  });

  it("respects manual overrides", () => {
    const key = programClauseKey(0, 0);
    const progress = evaluateProgram(program, {}, new Set([key]));
    expect(progress.clauses[key]).toMatchObject({ status: "met", manual: true });
    expect(progress.metClauses).toBe(1);
  });

  it("excludes advisory clauses from the clause counts", () => {
    const progress = evaluateProgram(
      programFrom(
        `<p>1. ${link("PHL200Y1")}</p> <p>Note: consult the department.</p>`,
      ),
      completedSet("PHL200Y1"),
      new Set(),
    );
    expect(progress.totalClauses).toBe(1);
    expect(progress.metClauses).toBe(1);
  });

  it("requires every item of an allOf clause", () => {
    const html = `<p>(1.0 credit)</p> <p>1. ${link("CSC207H1")}, ${link("CSC236H1")}</p>`;
    const partial = evaluateProgram(
      programFrom(html),
      completedSet("CSC207H1"),
      new Set(),
    );
    expect(partial.clauses[programClauseKey(0, 0)]!.status).toBe("partial");

    const met = evaluateProgram(
      programFrom(html),
      completedSet("CSC207H1", "CSC236H1"),
      new Set(),
    );
    expect(met.clauses[programClauseKey(0, 0)]!.status).toBe("met");
  });

  it("accepts any alternative of a oneOf clause", () => {
    const html = `<p>(0.5 credit)</p> <p>1. ${link("CSC236H1")}${OR}${link("CSC240H1")}</p>`;
    const progress = evaluateProgram(
      programFrom(html),
      completedSet("CSC240H1"),
      new Set(),
    );
    expect(progress.clauses[programClauseKey(0, 0)]!.status).toBe("met");
  });

  it("matches pool clauses by subject and level", () => {
    const progress = evaluateProgram(
      programFrom(`<p>(1.0 credit)</p> <p>1. 1.0 credit at the 300+ level ECO</p>`),
      completedSet("ECO320H1", "ECO420H1", "ECO101H1", "CSC373H1"),
      new Set(),
    );
    const clause = progress.clauses[programClauseKey(0, 0)]!;
    expect(clause.status).toBe("met");
    // ECO101H1 is below the level; CSC373H1 is the wrong subject.
    expect(clause.matchedCourses.sort()).toEqual(["ECO320H1", "ECO420H1"]);
  });

  it("honours pool exclusions", () => {
    const progress = evaluateProgram(
      programFrom(
        `<p>(1.0 credit)</p> <p>1. 1.0 credit from any 300-level CSC course except ${link("CSC373H1")}</p>`,
      ),
      completedSet("CSC373H1", "CSC369H1"),
      new Set(),
    );
    expect(
      progress.clauses[programClauseKey(0, 0)]!.matchedCourses,
    ).toEqual(["CSC369H1"]);
  });

  it("reports unknown rather than guessing for an unconstrained pool", () => {
    // "Additional philosophy courses" — a lowercase subject word we cannot map
    // to a course prefix, so the evaluator declines to match anything.
    const progress = evaluateProgram(
      programFrom(
        `<p>(4.0 credits)</p> <p>1. Additional philosophy courses, to a total of 4.0 credits.</p>`,
      ),
      completedSet("PHL200Y1"),
      new Set(),
    );
    const clause = progress.clauses[programClauseKey(0, 0)]!;
    expect(clause.status).toBe("unknown");
    expect(clause.matchedCourses).toEqual([]);
  });

  it("reports unknown for an unparseable text clause", () => {
    const progress = evaluateProgram(
      programFrom(
        `<p>(2.0 credits)</p> <p>1. 2.0 credits arranged with the program coordinator</p>`,
      ),
      completedSet("PHL200Y1"),
      new Set(),
    );
    expect(progress.clauses[programClauseKey(0, 0)]!.status).toBe("unknown");
  });

  it("serves explicit course lists before open-ended pools", () => {
    // CSC373H1 satisfies clause 1 exactly; the pool must take CSC369H1 instead.
    const progress = evaluateProgram(
      programFrom(
        `<p>(1.5 credits)</p> <p>1. 1.0 credit at the 300+ level CSC<br />2. ${link("CSC373H1")}</p>`,
      ),
      completedSet("CSC373H1", "CSC369H1", "CSC301H1"),
      new Set(),
    );
    expect(progress.clauses[programClauseKey(0, 1)]!.matchedCourses).toEqual([
      "CSC373H1",
    ]);
    expect(
      progress.clauses[programClauseKey(0, 0)]!.matchedCourses,
    ).not.toContain("CSC373H1");
  });

  it("is deterministic across repeated evaluations", () => {
    const completed = completedSet("CSC301H1", "CSC369H1", "CSC373H1");
    const target = programFrom(
      `<p>(1.0 credit)</p> <p>1. 1.0 credit at the 300+ level CSC</p>`,
    );
    const first = evaluateProgram(target, completed, new Set());
    const second = evaluateProgram(target, completed, new Set());
    expect(first).toEqual(second);
  });

  it("returns an empty result for a program with no completion data", () => {
    const target = { ...programFrom(""), completion: null };
    const progress = evaluateProgram(target, completedSet("CSC108H1"), new Set());
    expect(progress).toEqual({
      totalCredits: null,
      earnedCredits: 0,
      percent: null,
      clauses: {},
      metClauses: 0,
      totalClauses: 0,
    });
  });

  it("handles an empty completed map", () => {
    const progress = evaluateProgram(program, {}, new Set());
    expect(progress.earnedCredits).toBe(0);
    expect(progress.metClauses).toBe(0);
    expect(progress.totalClauses).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Evaluator — how a clause claims courses
// ---------------------------------------------------------------------------

describe("evaluateProgram: oneOf claims one alternative", () => {
  it("takes only the best branch when the alternatives differ in weight", () => {
    // MAT135H1 (0.5) / MAT137Y1 (1.0). Having both must not earn 1.5 on a
    // clause worth at most 1.0, and the loser stays free for clause 2.
    const progress = evaluateProgram(
      programFrom(
        `<p>(1.5 credits)</p> <p>1. ${link("MAT135H1")}${OR}${link("MAT137Y1")}<br />2. ${link("MAT135H1")}</p>`,
      ),
      completedSet("MAT135H1", "MAT137Y1"),
      new Set(),
    );

    const first = progress.clauses[programClauseKey(0, 0)]!;
    expect(first.matchedCourses).toEqual(["MAT137Y1"]);
    expect(first.earnedCredits).toBe(1);
    expect(first.status).toBe("met");
    expect(progress.clauses[programClauseKey(0, 1)]!.matchedCourses).toEqual([
      "MAT135H1",
    ]);
    expect(progress.earnedCredits).toBe(1.5);
  });

  it("prefers a fully-met branch over a partially-met one", () => {
    // (MAT135H1, MAT136H1)/MAT137Y1 with MAT136H1 missing: the complete branch
    // wins even though the incomplete one comes first.
    const progress = evaluateProgram(
      programFrom(
        `<p>(1.5 credits)</p> <p>1. (${link("MAT135H1")}, ${link("MAT136H1")})${OR}${link("MAT137Y1")}<br />2. ${link("MAT135H1")}</p>`,
      ),
      completedSet("MAT135H1", "MAT137Y1"),
      new Set(),
    );

    const first = progress.clauses[programClauseKey(0, 0)]!;
    expect(first.status).toBe("met");
    expect(first.matchedCourses).toEqual(["MAT137Y1"]);
    expect(progress.clauses[programClauseKey(0, 1)]!.matchedCourses).toEqual([
      "MAT135H1",
    ]);
  });

  it("applies branch selection to a oneOf nested inside an allOf", () => {
    const progress = evaluateProgram(
      programFrom(
        `<p>(2.0 credits)</p> <p>1. ${link("CSC207H1")}, ${link("MAT135H1")}${OR}${link("MAT137Y1")}<br />2. ${link("MAT135H1")}</p>`,
      ),
      completedSet("CSC207H1", "MAT135H1", "MAT137Y1"),
      new Set(),
    );

    expect(progress.clauses[programClauseKey(0, 0)]!.matchedCourses).toEqual([
      "CSC207H1",
      "MAT137Y1",
    ]);
    expect(progress.clauses[programClauseKey(0, 1)]!.matchedCourses).toEqual([
      "MAT135H1",
    ]);
  });
});

describe("evaluateProgram: pools that cannot be scored", () => {
  it("claims nothing so later clauses are not starved", () => {
    // The "additional CSC courses" pool has no credit target of its own and
    // its clause has no cap, so it can never report those credits — it must
    // not swallow the 400-level courses clause 2 needs.
    const progress = evaluateProgram(
      programFrom(
        `<p>(1.5 credits)</p> <p>1. ${link("CSC301H1")}, and additional CSC courses at the 300+ level<br />2. 1.0 credit at the 400+ level CSC</p>`,
      ),
      completedSet("CSC301H1", "CSC413H1", "CSC420H1"),
      new Set(),
    );

    const open = progress.clauses[programClauseKey(0, 0)]!;
    expect(open.status).toBe("partial");
    // Only the course it names: the open pool claims nothing.
    expect(open.matchedCourses).toEqual(["CSC301H1"]);
    expect(open.earnedCredits).toBe(0.5);

    const scoreable = progress.clauses[programClauseKey(0, 1)]!;
    expect(scoreable.status).toBe("met");
    expect(scoreable.matchedCourses).toEqual(["CSC413H1", "CSC420H1"]);
  });

  it("still claims up to the target when the pool has one", () => {
    const progress = evaluateProgram(
      programFrom(
        `<p>(1.0 credit)</p> <p>1. 0.5 credits at the 300+ level CSC</p>`,
      ),
      completedSet("CSC369H1", "CSC373H1"),
      new Set(),
    );

    const clause = progress.clauses[programClauseKey(0, 0)]!;
    expect(clause.status).toBe("met");
    expect(clause.matchedCourses).toEqual(["CSC369H1"]);
  });
});

describe("evaluateProgram: manual overrides", () => {
  const html = `<p>(4.0 credits)</p> <p>1. 2.0 credits from CSC courses at the 200-/300-/400 level</p>`;
  const key = programClauseKey(0, 0);

  it("counts a hand-ticked clause for what it is worth", () => {
    const progress = evaluateProgram(programFrom(html), {}, new Set([key]));

    expect(progress.clauses[key]).toMatchObject({
      status: "met",
      manual: true,
      earnedCredits: 2,
      requiredCredits: 2,
    });
    expect(progress.earnedCredits).toBe(2);
    expect(progress.percent).toBe(50);
  });

  it("does not double count courses the clause already claimed", () => {
    const progress = evaluateProgram(
      programFrom(html),
      completedSet("CSC207H1"),
      new Set([key]),
    );

    // 0.5 claimed + a 2.0 clause is still 2.0, not 2.5.
    expect(progress.clauses[key]!.earnedCredits).toBe(2);
    expect(progress.earnedCredits).toBe(2);
  });

  it("keeps the claimed figure when the clause's worth is unknown", () => {
    const progress = evaluateProgram(
      programFrom(
        `<p>(2.0 credits)</p> <p>1. ${link("CSC207H1")}, and additional CSC courses at the 300+ level</p>`,
      ),
      completedSet("CSC207H1"),
      new Set([key]),
    );

    expect(progress.clauses[key]).toMatchObject({
      status: "met",
      requiredCredits: null,
      earnedCredits: 0.5,
    });
  });
});

describe("evaluateProgram: claiming under a cap", () => {
  const html = `<p>(1.5 credits)</p> <p>1. 0.5 credits from the following: ${link("PHL200Y1")}${OR}${link("PHL205H1")}<br />2. ${link("PHL200Y1")}</p>`;

  it("prefers the alternative that fits the cap exactly", () => {
    const progress = evaluateProgram(
      programFrom(html),
      completedSet("PHL200Y1", "PHL205H1"),
      new Set(),
    );

    const first = progress.clauses[programClauseKey(0, 0)]!;
    expect(first.matchedCourses).toEqual(["PHL205H1"]);
    expect(first.earnedCredits).toBe(0.5);
    // The 1.0-credit Y course is left for the clause that needs it.
    expect(progress.clauses[programClauseKey(0, 1)]!.matchedCourses).toEqual([
      "PHL200Y1",
    ]);
  });

  it("counts an oversized course when nothing smaller is available", () => {
    const progress = evaluateProgram(
      programFrom(html),
      completedSet("PHL200Y1"),
      new Set(),
    );

    const first = progress.clauses[programClauseKey(0, 0)]!;
    expect(first.status).toBe("met");
    expect(first.matchedCourses).toEqual(["PHL200Y1"]);
    // Reported as 0.5 / 0.5: the clause is not worth more than it asks for.
    expect(first.earnedCredits).toBe(0.5);
  });
});
