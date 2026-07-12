import type {
  Course,
  LinkedMeetingSection,
  MeetingTime,
  Section,
  SectionCode,
  TeachMethod,
} from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import type { PinnedCourse } from "@/stores/plan";

import {
  buildTermBlocks,
  detectLinkageViolationSectionKeys,
  sectionConflictsWithPlan,
  selectedSectionKey,
  type PlanSelectedSection,
  type SelectedTimetableSection,
} from "./timetable";

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

describe("detectLinkageViolationSectionKeys", () => {
  it("flags nothing for a valid CSC207 lecture + tutorial pair", () => {
    // TUT0201 links back to LEC0101 (the selected lecture) → the pair is valid.
    const selected: PlanSelectedSection[] = [
      linkedPlanSection("CSC207H1", "F", "LEC", "LEC0101"),
      linkedPlanSection("CSC207H1", "F", "TUT", "TUT0201", [linkedRef("LEC", "0101")]),
    ];

    expect(detectLinkageViolationSectionKeys(selected)).toEqual(new Set());
  });

  it("flags a tutorial linked to a different lecture than the one selected", () => {
    // TUT0301 links to LEC0201, but LEC0101 is selected. The tutorial's outgoing
    // link doesn't match, and the lecture (null links) is still permitted, so
    // only the tutorial key is flagged.
    const selected: PlanSelectedSection[] = [
      linkedPlanSection("CSC207H1", "F", "LEC", "LEC0101"),
      linkedPlanSection("CSC207H1", "F", "TUT", "TUT0301", [linkedRef("LEC", "0201")]),
    ];

    expect(detectLinkageViolationSectionKeys(selected)).toEqual(
      new Set([selectedSectionKey({ courseCode: "CSC207H1", sectionCode: "F" }, "TUT", "TUT0301")]),
    );
  });

  it("also flags a lecture that declares an empty outgoing link array", () => {
    // With linkedMeetingSections === [], the lecture is only permitted if the
    // selected tutorial links to it. Here TUT0301 links to LEC0201, so both the
    // lecture and the tutorial are flagged.
    const selected: PlanSelectedSection[] = [
      linkedPlanSection("CSC207H1", "F", "LEC", "LEC0101", []),
      linkedPlanSection("CSC207H1", "F", "TUT", "TUT0301", [linkedRef("LEC", "0201")]),
    ];

    expect(detectLinkageViolationSectionKeys(selected)).toEqual(
      new Set([
        selectedSectionKey({ courseCode: "CSC207H1", sectionCode: "F" }, "LEC", "LEC0101"),
        selectedSectionKey({ courseCode: "CSC207H1", sectionCode: "F" }, "TUT", "TUT0301"),
      ]),
    );
  });

  it("does not compare sections across different courses", () => {
    // A tutorial with an unmatched link is nonetheless permitted here: it has no
    // OTHER selected section within its own course to violate linkage against
    // (the MAT lecture belongs to a different course and is never compared).
    const selected: PlanSelectedSection[] = [
      linkedPlanSection("CSC207H1", "F", "TUT", "TUT0301", [linkedRef("LEC", "0201")]),
      linkedPlanSection("MAT137Y1", "Y", "LEC", "LEC0101"),
    ];

    expect(detectLinkageViolationSectionKeys(selected)).toEqual(new Set());
  });
});

describe("buildTermBlocks", () => {
  it("marks blocks whose section key is in the disallowed set", () => {
    const lecture = timetableSection("CSC207H1", "F", "LEC", "LEC0101", [
      meeting(1, "10:00", "11:00", "20269"),
    ]);
    const tutorial = timetableSection("CSC207H1", "F", "TUT", "TUT0301", [
      meeting(2, "13:00", "14:00", "20269"),
    ]);
    const disallowedSectionKeys = new Set([tutorial.key]);

    const { blocks } = buildTermBlocks([lecture, tutorial], "fall", { disallowedSectionKeys });

    const lectureBlock = blocks.find((block) => block.sectionKey === lecture.key);
    const tutorialBlock = blocks.find((block) => block.sectionKey === tutorial.key);

    expect(lectureBlock?.disallowed).toBe(false);
    expect(tutorialBlock?.disallowed).toBe(true);
  });

  it("defaults disallowed to false when no set is provided", () => {
    const lecture = timetableSection("CSC207H1", "F", "LEC", "LEC0101", [
      meeting(1, "10:00", "11:00", "20269"),
    ]);

    const { blocks } = buildTermBlocks([lecture], "fall");

    expect(blocks.every((block) => block.disallowed === false)).toBe(true);
  });
});

function linkedPlanSection(
  courseCode: string,
  sectionCode: SectionCode,
  teachMethod: TeachMethod,
  sectionName: string,
  linkedMeetingSections: LinkedMeetingSection[] | null = null,
): PlanSelectedSection {
  return {
    courseKey: `${courseCode}:${sectionCode}`,
    courseCode,
    sectionCode,
    teachMethod,
    section: {
      ...section(teachMethod, sectionName),
      linkedMeetingSections,
    },
  };
}

function timetableSection(
  courseCode: string,
  sectionCode: SectionCode,
  teachMethod: TeachMethod,
  sectionName: string,
  meetings: MeetingTime[],
): SelectedTimetableSection {
  const pinned: PinnedCourse = { courseCode, sectionCode, chosen: {} };
  const sec = section(teachMethod, sectionName, ...meetings);
  const course = {
    id: courseCode,
    code: courseCode,
    sectionCode,
    name: courseCode,
    sections: [sec],
  } as unknown as Course;

  return {
    key: selectedSectionKey(pinned, teachMethod, sectionName),
    courseKey: `${courseCode}:${sectionCode}`,
    course,
    pinned,
    teachMethod,
    section: sec,
  };
}

function linkedRef(teachMethod: string, sectionNumber: string): LinkedMeetingSection {
  return { teachMethod, sectionNumber, type: null };
}

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
