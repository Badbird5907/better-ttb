import type { MeetingTime, Section, SectionCode, TeachMethod } from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import { sectionConflictsWithPlan, type PlanSelectedSection } from "./timetable";

describe("sectionConflictsWithPlan", () => {
  it("does not flag an F section against an S section at the same time", () => {
    // Fall-only and Winter-only courses never share a term, so an identical
    // time slot is not a real conflict.
    const candidate = section("LEC", "LEC0101", meeting(1, "10:00", "11:00", "20269"));
    const selected: PlanSelectedSection[] = [
      planSection("MAT100H1", "S", "LEC", "LEC0101", meeting(1, "10:00", "11:00", "20271")),
    ];

    expect(
      sectionConflictsWithPlan(candidate, "F", "CSC100H1:F", selected),
    ).toBeNull();
  });

  it("flags a Y section overlapping an F section in the fall term", () => {
    // The Y course meets in the fall (session 20269) and collides with the
    // fall-only course, so the overlap surfaces in the fall term comparison.
    const candidate = section("LEC", "LEC0101", meeting(2, "13:00", "14:00", "20269"));
    const fallSelection = planSection(
      "PHY100H1",
      "F",
      "LEC",
      "LEC0101",
      meeting(2, "13:00", "14:00", "20269"),
    );
    const selected: PlanSelectedSection[] = [fallSelection];

    const conflict = sectionConflictsWithPlan(candidate, "Y", "MAT137Y1:Y", selected);

    expect(conflict).toBe(fallSelection);
  });

  it("skips sections belonging to the same course", () => {
    // Two teaching methods of the same pinned course are never compared to
    // each other, even when their times overlap.
    const candidate = section("TUT", "TUT0101", meeting(3, "09:00", "10:00", "20269"));
    const selected: PlanSelectedSection[] = [
      planSection("CSC108H1", "F", "LEC", "LEC0101", meeting(3, "09:00", "10:00", "20269")),
    ];

    expect(
      sectionConflictsWithPlan(candidate, "F", "CSC108H1:F", selected),
    ).toBeNull();
  });
});

function planSection(
  courseCode: string,
  sectionCode: SectionCode,
  teachMethod: TeachMethod,
  sectionName: string,
  ...meetings: MeetingTime[]
): PlanSelectedSection {
  return {
    courseKey: `${courseCode}:${sectionCode}`,
    courseCode,
    sectionCode,
    teachMethod,
    section: section(teachMethod, sectionName, ...meetings),
  };
}

function section(
  teachMethod: TeachMethod,
  sectionName: string,
  ...meetings: MeetingTime[]
): Section {
  return {
    name: sectionName,
    type: "Lecture",
    teachMethod,
    sectionNumber: sectionName.replace(/\D/g, ""),
    meetingTimes: meetings,
    instructors: [],
    currentEnrolment: 0,
    maxEnrolment: 100,
    currentWaitlist: 0,
    waitlistInd: "N",
    cancelInd: "N",
    enrolmentInd: "",
    tbaInd: "N",
    openLimitInd: "",
    deliveryModes: [{ session: "20269", mode: "INPER" }],
    subTitle: "",
    notes: [],
    enrolmentControls: [],
    linkedMeetingSections: null,
  };
}

function meeting(
  day: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  start: string,
  end: string,
  sessionCode: string,
): MeetingTime {
  return {
    start: { day, millisofday: hhmmToMillis(start) },
    end: { day, millisofday: hhmmToMillis(end) },
    building: {
      buildingCode: "BA",
      buildingRoomNumber: "1130",
      buildingRoomSuffix: "",
      buildingUrl: "",
      buildingName: null,
    },
    sessionCode,
    repetitionTime: "ONCE_A_WEEK",
  };
}

function hhmmToMillis(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return ((hours ?? 0) * 60 + (minutes ?? 0)) * 60_000;
}
