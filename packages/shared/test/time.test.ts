import { describe, expect, it } from "vitest";

import {
  FALL_2026,
  YEAR,
  formatDay,
  formatSessionLabel,
  meetingTimesOverlap,
  millisofdayToHHMM,
  parseSessionCode,
} from "../src";
import type { MeetingTime } from "../src";

const meeting = (day: 1 | 2 | 3 | 4 | 5 | 6 | 7, start: number, end: number): MeetingTime => ({
  start: { day, millisofday: start },
  end: { day, millisofday: end },
  building: {
    buildingCode: "BA",
    buildingRoomNumber: "1170",
    buildingRoomSuffix: "",
    buildingUrl: "",
    buildingName: "Bahen Centre",
  },
  sessionCode: FALL_2026,
  repetitionTime: "ONCE_A_WEEK",
});

describe("time utilities", () => {
  it("formats millis of day as HH:MM", () => {
    expect(millisofdayToHHMM(9 * 60 * 60 * 1000 + 30 * 60 * 1000)).toBe("09:30");
  });

  it("formats UofT day numbers", () => {
    expect(formatDay(1)).toBe("Mon");
    expect(formatDay(7)).toBe("Sun");
  });

  it("detects same-day time intersections", () => {
    expect(meetingTimesOverlap(meeting(1, 10, 20), meeting(1, 19, 30))).toBe(true);
    expect(meetingTimesOverlap(meeting(1, 10, 20), meeting(1, 20, 30))).toBe(false);
    expect(meetingTimesOverlap(meeting(1, 10, 20), meeting(2, 15, 30))).toBe(false);
  });

  it("parses and labels session codes", () => {
    expect(parseSessionCode(FALL_2026)).toEqual({ year: 2026, term: "fall" });
    expect(formatSessionLabel(YEAR)).toBe("Fall 2026 / Winter 2027");
  });
});
