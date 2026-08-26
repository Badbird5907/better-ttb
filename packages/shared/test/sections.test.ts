import { describe, expect, it } from "vitest";

import { compareSectionsByTime, sortSectionsByTime, sortedMeetingTimes } from "../src";
import type { DayNumber, MeetingTime, Section } from "../src";

const HOUR = 3_600_000;

function meeting(day: DayNumber, startHour: number, endHour: number): MeetingTime {
  return {
    start: { day, millisofday: startHour * HOUR },
    end: { day, millisofday: endHour * HOUR },
    building: {
      buildingCode: "BA",
      buildingRoomNumber: "1180",
      buildingRoomSuffix: "",
      buildingUrl: "",
      buildingName: null,
    },
    sessionCode: "20269",
    repetition: "WEEKLY",
    repetitionTime: "ONCE_A_WEEK",
  };
}

function section(name: string, meetingTimes: MeetingTime[]): Section {
  return {
    name,
    type: "Lecture",
    teachMethod: "LEC",
    sectionNumber: name.slice(3),
    meetingTimes,
    instructors: [],
    currentEnrolment: 0,
    maxEnrolment: 100,
    currentWaitlist: 0,
    waitlistInd: "N",
    cancelInd: "",
    enrolmentInd: "",
    tbaInd: "N",
    openLimitInd: "",
    deliveryModes: [],
    subTitle: "",
    notes: [],
    enrolmentControls: [],
    linkedMeetingSections: [],
  };
}

describe("sortedMeetingTimes", () => {
  it("orders a section's meetings by day, then start time", () => {
    const wednesdayAfternoon = meeting(3, 13, 14);
    const wednesdayMorning = meeting(3, 9, 10);
    const monday = meeting(1, 15, 16);

    expect(
      sortedMeetingTimes(
        section("LEC0101", [wednesdayAfternoon, monday, wednesdayMorning]),
      ),
    ).toEqual([monday, wednesdayMorning, wednesdayAfternoon]);
  });

  it("leaves the section's own array untouched", () => {
    const meetingTimes = [meeting(3, 13, 14), meeting(3, 9, 10)];

    sortedMeetingTimes(section("LEC0101", meetingTimes));

    expect(meetingTimes[0]?.start.millisofday).toBe(13 * HOUR);
  });
});

describe("sortSectionsByTime", () => {
  it("orders sections by their earliest meeting", () => {
    const afternoon = section("LEC0101", [meeting(3, 13, 14)]);
    const morning = section("LEC0201", [meeting(3, 9, 10)]);
    // Out-of-order meetings must not hide an early start.
    const earlyButListedLate = section("LEC0301", [
      meeting(4, 16, 17),
      meeting(1, 8, 9),
    ]);

    expect(
      sortSectionsByTime([afternoon, morning, earlyButListedLate]).map(
        (entry) => entry.name,
      ),
    ).toEqual(["LEC0301", "LEC0201", "LEC0101"]);
  });

  it("sorts sections without meeting times last and breaks ties by name", () => {
    const tba = section("LEC0001", []);
    const alsoTba = section("LEC0002", []);
    const scheduled = section("LEC0901", [meeting(5, 18, 19)]);

    expect(
      sortSectionsByTime([tba, scheduled, alsoTba]).map((entry) => entry.name),
    ).toEqual(["LEC0901", "LEC0001", "LEC0002"]);
  });

  it("breaks identical time slots by section name", () => {
    const first = section("LEC0101", [meeting(2, 10, 11)]);
    const second = section("LEC0201", [meeting(2, 10, 11)]);

    expect(compareSectionsByTime(second, first)).toBeGreaterThan(0);
  });
});
