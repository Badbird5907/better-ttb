import { describe, expect, it } from "vitest";

import {
  DEFAULT_RULES,
  detectConflicts,
  generate,
  walkMinutes,
  type CourseInput,
  type RuleConfig,
} from "../src";
import { course, meeting, ms, section } from "./fixtures";

const noRules: RuleConfig[] = [];

describe("detectConflicts", () => {
  it("detects overlaps, ignores adjacent meetings, and respects alternating weeks", () => {
    const overlapping = [
      section("LEC0101", "LEC", [meeting(1, ms(9), ms(10))]),
      section("TUT0101", "TUT", [meeting(1, ms(9, 30), ms(10, 30))]),
    ];
    const adjacent = [
      section("LEC0101", "LEC", [meeting(1, ms(9), ms(10))]),
      section("TUT0101", "TUT", [meeting(1, ms(10), ms(11))]),
    ];
    const alternating = [
      section("LEC0101", "LEC", [
        meeting(1, ms(9), ms(10), { repetitionTime: "FIRST_AND_THIRD_WEEK" }),
      ]),
      section("TUT0101", "TUT", [
        meeting(1, ms(9), ms(10), { repetitionTime: "SECOND_AND_FOURTH_WEEK" }),
      ]),
    ];

    expect(detectConflicts(overlapping)).toHaveLength(1);
    expect(detectConflicts(adjacent)).toHaveLength(0);
    expect(detectConflicts(alternating)).toHaveLength(0);
  });

  it("applies F/S/Y term constraints so Y conflicts with F in fall but F and S do not conflict", () => {
    const fall = course("FALL101H1", "F", [
      section("LEC0101", "LEC", [meeting(2, ms(10), ms(11))]),
    ]);
    const winter = course("WINT101H1", "S", [
      section("LEC0101", "LEC", [meeting(2, ms(10), ms(11))]),
    ]);
    const yearLong = course("YEAR101Y1", "Y", [
      section("LEC0101", "LEC", [meeting(2, ms(10), ms(11))]),
    ]);

    expect(generate([{ course: fall }, { course: winter }], { rules: noRules }).candidates).toHaveLength(
      1,
    );
    const result = generate([{ course: fall }, { course: yearLong }], { rules: noRules });

    expect(result.candidates).toHaveLength(0);
    expect(result.infeasible?.conflictingCourses).toEqual(["FALL101H1", "YEAR101Y1"]);
  });
});

describe("generate selections", () => {
  it("enumerates one section per teach method and respects locks and exclusions", () => {
    const input = course("CSC108H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(9), ms(10))]),
      section("LEC0201", "LEC", [meeting(1, ms(11), ms(12))]),
      section("TUT0101", "TUT", [meeting(2, ms(9), ms(10))]),
      section("TUT0201", "TUT", [meeting(2, ms(11), ms(12))]),
    ]);

    const all = generate([{ course: input }], { rules: noRules, maxResults: 10 });

    expect(all.candidates).toHaveLength(4);
    expect(all.candidates.every((candidate) => candidate.selections.length === 2)).toBe(true);

    const locked = generate(
      [
        {
          course: input,
          locked: { LEC: "LEC0201" },
          excludedSections: ["TUT0101"],
        },
      ],
      { rules: noRules, maxResults: 10 },
    );

    expect(locked.candidates).toHaveLength(1);
    expect(locked.candidates[0]?.selections).toEqual([
      { courseCode: "CSC108H1", teachMethod: "LEC", sectionName: "LEC0201" },
      { courseCode: "CSC108H1", teachMethod: "TUT", sectionName: "TUT0201" },
    ]);
  });

  it("skips cancelled sections and reports infeasible locks", () => {
    const input = course("MAT135H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(9), ms(10))], { cancelInd: "Y" }),
      section("LEC0201", "LEC", [meeting(1, ms(11), ms(12))]),
    ]);

    const result = generate([{ course: input, locked: { LEC: "LEC0101" } }], {
      rules: noRules,
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.infeasible?.conflictingCourses).toEqual(["MAT135H1"]);
  });
});

describe("rule evaluation", () => {
  it("scores soft max-gap proportionally and rejects hard max-gap violations", () => {
    const first = course("AAA100H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(9), ms(10))]),
    ]);
    const second = course("BBB100H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(11, 30), ms(12, 30))]),
      section("LEC0201", "LEC", [meeting(1, ms(13), ms(14))]),
    ]);
    const softRule: RuleConfig = {
      id: "gap",
      kind: "max-gap",
      mode: "soft",
      weight: 1,
      maxGapMinutes: 60,
    };

    const soft = generate([{ course: first }, { course: second }], {
      rules: [softRule],
      maxResults: 10,
    });

    expect(soft.candidates).toHaveLength(2);
    expect(soft.candidates[0]?.score).toBeGreaterThan(soft.candidates[1]?.score ?? 0);
    expect(soft.candidates[0]?.metrics[0]?.penalty).toBeLessThan(
      soft.candidates[1]?.metrics[0]?.penalty ?? 0,
    );

    const hard = generate([{ course: first }, { course: second }], {
      rules: [{ ...softRule, mode: "hard" }],
      maxResults: 10,
    });

    expect(hard.candidates).toHaveLength(0);
  });

  it("checks walking distance, tight transfers, and impossible transfers", () => {
    const first = course("WALK100H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(10), ms(11), { buildingCode: "A" })]),
    ]);
    const second = course("WALK200H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(11, 5), ms(12), { buildingCode: "B" })]),
    ]);
    const buildings = {
      A: { lat: 43.6605, lng: -79.395 },
      B: { lat: 43.6675, lng: -79.391 },
    };
    // Real walk durations: A->B is 40 min, far beyond the graced 15-min window
    // (5-min listed gap + 10-min UofT grace), so the transfer is impossible.
    const walkSeconds = { "A|B": 40 * 60, "B|A": 40 * 60 };
    const rule: RuleConfig = {
      id: "walk",
      kind: "max-walk",
      mode: "soft",
      weight: 1,
      maxWalkMinutes: 30,
    };

    expect(walkMinutes(buildings.A, buildings.A)).toBe(0);
    expect(walkMinutes(buildings.A, buildings.B)).toBeGreaterThan(5);

    const soft = generate([{ course: first }, { course: second }], {
      rules: [rule],
      buildings,
      walkSeconds,
    });

    expect(soft.candidates[0]?.metrics[0]?.detail).toContain("1 impossible transfers");
    expect(soft.candidates[0]?.extras.tightTransfers).toHaveLength(1);
    // The reported walk uses the real 40-min matrix duration, not haversine.
    expect(soft.candidates[0]?.extras.tightTransfers[0]?.walkMin).toBe(40);

    const hard = generate([{ course: first }, { course: second }], {
      rules: [{ ...rule, mode: "hard" }],
      buildings,
      walkSeconds,
    });

    expect(hard.candidates).toHaveLength(0);
  });

  it("applies the 10-minute UofT grace to back-to-back walk feasibility", () => {
    // Two classes with a 0-minute listed gap (prev ends 11:00, next starts 11:00).
    const first = course("GRC100H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(10), ms(11), { buildingCode: "A" })]),
    ]);
    const second = course("GRC200H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(11), ms(12), { buildingCode: "B" })]),
    ]);
    const buildings = {
      A: { lat: 43.6605, lng: -79.395 },
      B: { lat: 43.6675, lng: -79.391 },
    };
    const rule: RuleConfig = {
      id: "walk",
      kind: "max-walk",
      mode: "hard",
      weight: 1,
      maxWalkMinutes: 30,
    };

    // 8-min walk into a 0-min listed gap is OK because the 10-min grace makes the
    // real window 10 min.
    const okWalk = generate([{ course: first }, { course: second }], {
      rules: [rule],
      buildings,
      walkSeconds: { "A|B": 8 * 60, "B|A": 8 * 60 },
    });

    expect(okWalk.candidates).toHaveLength(1);
    expect(okWalk.candidates[0]?.extras.tightTransfers[0]?.walkMin).toBe(8);

    // 12-min walk into the same 0-min gap exceeds the 10-min graced window: tight
    // and, as a hard rule, a violation that removes the candidate.
    const tightWalk = generate([{ course: first }, { course: second }], {
      rules: [rule],
      buildings,
      walkSeconds: { "A|B": 12 * 60, "B|A": 12 * 60 },
    });

    expect(tightWalk.candidates).toHaveLength(0);
  });

  it("handles blocked windows, earliest/latest bounds, days off, and lunch breaks", () => {
    const blockedCourse = course("BLK100H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(10), ms(11))]),
    ]);
    const eveningCourse = course("EVE100H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(8), ms(18))]),
    ]);
    const lunchCourse = course("LUN100H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(12), ms(14))]),
    ]);

    expect(
      generate([{ course: blockedCourse }], {
        rules: [
          {
            id: "blocked",
            kind: "blocked-times",
            mode: "hard",
            weight: 1,
            windows: [{ day: 1, startMillis: ms(10, 30), endMillis: ms(10, 45) }],
          },
        ],
      }).candidates,
    ).toHaveLength(0);

    expect(
      generate([{ course: eveningCourse }], {
        rules: [
          {
            id: "early",
            kind: "earliest-start",
            mode: "hard",
            weight: 1,
            millisofday: ms(9),
          },
          {
            id: "late",
            kind: "latest-end",
            mode: "hard",
            weight: 1,
            millisofday: ms(17),
          },
        ],
      }).candidates,
    ).toHaveLength(0);

    expect(
      generate([{ course: blockedCourse }], {
        rules: [
          {
            id: "specific-day-off",
            kind: "days-off",
            mode: "hard",
            weight: 1,
            days: [1],
          },
        ],
      }).candidates,
    ).toHaveLength(0);

    expect(
      generate([{ course: lunchCourse }], {
        rules: [
          {
            id: "lunch",
            kind: "lunch-break",
            mode: "hard",
            weight: 1,
            startMillis: ms(12),
            endMillis: ms(14),
            minMinutes: 30,
          },
        ],
      }).candidates,
    ).toHaveLength(0);
  });

  it("scores enrolment, delivery, instructor, compactness, and default rules", () => {
    const input = course("PREF100H1", "F", [
      section("LEC0101", "LEC", [meeting(1, ms(8), ms(9))], {
        currentEnrolment: 100,
        maxEnrolment: 100,
        waitlistInd: "Y",
        deliveryModes: ["SYNC"],
        instructors: [{ firstName: "Grace", lastName: "Hopper" }],
      }),
      section("LEC0201", "LEC", [meeting(1, ms(10), ms(11))], {
        deliveryModes: ["INPER"],
        instructors: [{ firstName: "Ada", lastName: "Lovelace" }],
      }),
    ]);
    const rules: RuleConfig[] = [
      { id: "full", kind: "avoid-full-sections", mode: "soft", weight: 0.25 },
      { id: "wait", kind: "avoid-waitlist", mode: "soft", weight: 0.25 },
      {
        id: "delivery",
        kind: "prefer-delivery",
        mode: "soft",
        weight: 0.25,
        modes: ["INPER"],
      },
      {
        id: "instructor",
        kind: "prefer-instructor",
        mode: "soft",
        weight: 0.25,
        names: ["lovelace"],
      },
      { id: "compact", kind: "compactness", mode: "soft", weight: 0, preference: "compact" },
    ];

    const result = generate([{ course: input }], { rules, maxResults: 10 });

    expect(DEFAULT_RULES.map((rule) => rule.kind)).toEqual([
      "max-gap",
      "avoid-waitlist",
      "earliest-start",
    ]);
    expect(result.candidates[0]?.selections[0]?.sectionName).toBe("LEC0201");
    expect(result.candidates[0]?.score).toBeGreaterThan(result.candidates[1]?.score ?? 0);
  });
});

describe("search behavior", () => {
  it("is deterministic, respects maxCombinations, and reports infeasible pairs", () => {
    const inputs: CourseInput[] = [
      {
        course: course("DET100H1", "F", [
          section("LEC0201", "LEC", [meeting(1, ms(13), ms(14))]),
          section("LEC0101", "LEC", [meeting(1, ms(9), ms(10))]),
        ]),
      },
      {
        course: course("DET200H1", "F", [
          section("LEC0101", "LEC", [meeting(2, ms(9), ms(10))]),
          section("LEC0201", "LEC", [meeting(2, ms(11), ms(12))]),
        ]),
      },
    ];

    const first = generate(inputs, { rules: DEFAULT_RULES, maxResults: 10 });
    const second = generate(inputs, { rules: DEFAULT_RULES, maxResults: 10 });

    expect(second.candidates).toEqual(first.candidates);

    const budgetCourses = [1, 2, 3].map((index) => ({
      course: course(`BUD${index}00H1`, "F", [
        section("LEC0101", "LEC", [meeting(index as 1 | 2 | 3, ms(9), ms(10))]),
        section("LEC0201", "LEC", [meeting(index as 1 | 2 | 3, ms(11), ms(12))]),
        section("LEC0301", "LEC", [meeting(index as 1 | 2 | 3, ms(13), ms(14))]),
      ]),
    }));
    const budget = generate(budgetCourses, { rules: noRules, maxCombinations: 2 });

    expect(budget.stats.enumerated).toBe(2);
    expect(budget.stats.exhaustive).toBe(false);

    const conflictA = course("CON100H1", "F", [
      section("LEC0101", "LEC", [meeting(3, ms(10), ms(11))]),
    ]);
    const conflictB = course("CON200H1", "F", [
      section("LEC0101", "LEC", [meeting(3, ms(10, 30), ms(11, 30))]),
    ]);
    const infeasible = generate([{ course: conflictA }, { course: conflictB }], {
      rules: noRules,
    });

    expect(infeasible.candidates).toHaveLength(0);
    expect(infeasible.infeasible?.conflictingCourses).toEqual(["CON100H1", "CON200H1"]);
  });

  it("returns ranked candidates for a realistic 5-course search", () => {
    const inputs: CourseInput[] = [
      {
        course: course("CSC108H1", "F", [
          section("LEC0101", "LEC", [meeting(1, ms(9), ms(10))]),
          section("LEC0201", "LEC", [meeting(2, ms(14), ms(15))]),
          section("TUT0101", "TUT", [meeting(4, ms(10), ms(11))]),
          section("TUT0201", "TUT", [meeting(5, ms(13), ms(14))]),
        ]),
      },
      {
        course: course("MAT135H1", "F", [
          section("LEC0101", "LEC", [meeting(1, ms(10), ms(11))]),
          section("LEC0201", "LEC", [meeting(3, ms(9), ms(10))]),
          section("TUT0101", "TUT", [meeting(5, ms(9), ms(10))]),
        ]),
      },
      {
        course: course("STA130H1", "F", [
          section("LEC0101", "LEC", [meeting(2, ms(10), ms(11))]),
          section("LEC0201", "LEC", [meeting(4, ms(14), ms(15))]),
          section("PRA0101", "PRA", [meeting(3, ms(13), ms(14))]),
        ]),
      },
      {
        course: course("ECO101H1", "F", [
          section("LEC0101", "LEC", [meeting(3, ms(11), ms(12))]),
          section("LEC0201", "LEC", [meeting(5, ms(11), ms(12))]),
          section("TUT0101", "TUT", [meeting(2, ms(9), ms(10))]),
          section("TUT0201", "TUT", [meeting(4, ms(9), ms(10))]),
        ]),
      },
      {
        course: course("PHL100H1", "F", [
          section("LEC0101", "LEC", [meeting(1, ms(12), ms(13))]),
          section("LEC0201", "LEC", [meeting(4, ms(12), ms(13))]),
          section("TUT0101", "TUT", [meeting(3, ms(15), ms(16))]),
        ]),
      },
    ];
    const rules: RuleConfig[] = [
      { id: "gap", kind: "max-gap", mode: "soft", weight: 0.6, maxGapMinutes: 90 },
      { id: "days", kind: "days-off", mode: "soft", weight: 0.2, count: 2 },
      { id: "start", kind: "earliest-start", mode: "soft", weight: 0.2, millisofday: ms(9) },
    ];

    const result = generate(inputs, { rules, maxResults: 8, maxCombinations: 10_000 });

    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.candidates.length).toBeLessThanOrEqual(8);
    for (let index = 1; index < result.candidates.length; index += 1) {
      expect(result.candidates[index - 1]?.score).toBeGreaterThanOrEqual(
        result.candidates[index]?.score ?? 0,
      );
    }
    expect(result.candidates[0]?.score).toBeGreaterThanOrEqual(result.candidates.at(-1)?.score ?? 0);
    expect(result.stats.feasible).toBeGreaterThanOrEqual(result.candidates.length);
  });
});
