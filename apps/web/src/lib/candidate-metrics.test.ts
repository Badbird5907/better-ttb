import type { CandidateTimetable } from "@better-ttb/generator";
import { describe, expect, it } from "vitest";

import {
  candidateChips,
  scoreTone,
  waitlistedCount,
  worstGapMinutes,
} from "./candidate-metrics";

function candidate(overrides: Partial<CandidateTimetable> = {}): CandidateTimetable {
  return {
    selections: [],
    score: 0,
    metrics: [],
    extras: {
      totalWalkMinutesPerDay: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 },
      tightTransfers: [],
      daysOnCampus: { fall: [], winter: [] },
      earliestStart: null,
      latestEnd: null,
    },
    ...overrides,
  };
}

describe("scoreTone", () => {
  it("buckets scores into good/warn/muted", () => {
    expect(scoreTone(95)).toBe("good");
    expect(scoreTone(80)).toBe("good");
    expect(scoreTone(79.9)).toBe("warn");
    expect(scoreTone(60)).toBe("warn");
    expect(scoreTone(59.9)).toBe("muted");
    expect(scoreTone(0)).toBe("muted");
  });
});

describe("worstGapMinutes", () => {
  it("parses the largest worst-gap value across metrics", () => {
    const result = candidate({
      metrics: [
        { ruleId: "a", penalty: 0.2, detail: "1 gaps > 60min (worst 95min)" },
        { ruleId: "b", penalty: 0.4, detail: "2 gaps > 30min (worst 130min)" },
      ],
    });

    expect(worstGapMinutes(result)).toBe(130);
  });

  it("returns 0 when no gap detail is present", () => {
    expect(worstGapMinutes(candidate({ metrics: [{ ruleId: "x", penalty: 0, detail: "0 gaps > 60min" }] }))).toBe(0);
    expect(worstGapMinutes(candidate())).toBe(0);
  });
});

describe("waitlistedCount", () => {
  it("parses the waitlistable section count", () => {
    expect(
      waitlistedCount(candidate({ metrics: [{ ruleId: "w", penalty: 0.5, detail: "3 waitlistable sections" }] })),
    ).toBe(3);
  });

  it("returns 0 when the rule is absent", () => {
    expect(waitlistedCount(candidate())).toBe(0);
  });
});

describe("candidateChips", () => {
  it("always returns exactly four chips in a stable order", () => {
    const chips = candidateChips(
      candidate({
        score: 72,
        metrics: [
          { ruleId: "g", penalty: 0.1, detail: "1 gaps > 60min (worst 90min)" },
          { ruleId: "w", penalty: 0.2, detail: "2 waitlistable sections" },
        ],
        extras: {
          totalWalkMinutesPerDay: { 1: 5.4, 2: 0, 3: 2.1, 4: 0, 5: 0, 6: 0, 7: 0 },
          tightTransfers: [],
          daysOnCampus: { fall: [1, 3], winter: [2] },
          earliestStart: null,
          latestEnd: null,
        },
      }),
    );

    expect(chips.map((chip) => chip.key)).toEqual(["walk", "campus", "gap", "waitlist"]);
    expect(chips[0]?.value).toBe(8); // rounded 7.5
    expect(chips[1]?.value).toBe(3); // 2 fall + 1 winter
    expect(chips[2]?.value).toBe(90);
    expect(chips[3]?.value).toBe(2);
  });
});
