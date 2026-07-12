import type {
  Course,
  DayNumber,
  LinkedMeetingSection,
  MeetingTime,
  Section,
  SectionCode,
  TeachMethod,
} from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import type { TimetableBlock } from "@/lib/timetable";

import {
  buildAlternativeDraftBlocks,
  groupAlternativesBySlot,
  linkageImpact,
  listAlternativeSections,
  walkFromPreviousBlock,
} from "./section-alternatives";

describe("listAlternativeSections", () => {
  it("keeps visible waitlisted alternatives while hiding current, cancelled, and closed sections", () => {
    const course = makeCourse([
      section("LEC", "LEC0101"),
      section("LEC", "LEC0201"),
      section("LEC", "LEC0301", { cancelInd: "Y" }),
      section("LEC", "LEC0401", { openLimitInd: "C" }),
      section("TUT", "TUT0101"),
    ]);

    const alternatives = listAlternativeSections(course, "LEC", "LEC0101");

    expect(alternatives.map((entry) => entry.name)).toEqual(["LEC0201"]);
  });
});

describe("groupAlternativesBySlot", () => {
  it("groups sections by active meeting slot and repeats multi-meeting sections", () => {
    const lec0201 = section("LEC", "LEC0201", {
      meetingTimes: [
        meeting(1, "10:00", "11:00", "BA"),
        meeting(3, "12:00", "13:00", "MP"),
      ],
    });
    const lec0301 = section("LEC", "LEC0301", {
      meetingTimes: [meeting(1, "10:00", "11:00", "SS")],
    });

    const groups = groupAlternativesBySlot([lec0201, lec0301], "fall");

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      day: 1,
      startMillis: hhmmToMillis("10:00"),
      endMillis: hhmmToMillis("11:00"),
    });
    expect(groups[0]?.options.map((option) => option.name)).toEqual([
      "LEC0201",
      "LEC0301",
    ]);
    expect(groups[1]?.options.map((option) => option.name)).toEqual(["LEC0201"]);
  });
});

describe("linkageImpact", () => {
  it("clears an incompatible linked section and auto-picks the only compatible replacement", () => {
    const course = makeCourse([
      section("LEC", "LEC0101"),
      section("LEC", "LEC0201"),
      section("TUT", "TUT0101", { linkedMeetingSections: [linked("LEC", "0101")] }),
      section("TUT", "TUT0201", { linkedMeetingSections: [linked("LEC", "0201")] }),
      section("TUT", "TUT0301", {
        linkedMeetingSections: [linked("LEC", "0201")],
        openLimitInd: "C",
      }),
    ]);

    const impact = linkageImpact(
      course,
      "CSC207H1:F",
      { LEC: "LEC0101", TUT: "TUT0101" },
      "LEC",
      course.sections[1]!,
      [],
    );

    expect(impact).toEqual({
      clears: ["TUT"],
      autoPicks: [{ teachMethod: "TUT", sectionName: "TUT0201" }],
    });
  });

  it("auto-picks the best replacement when multiple compatible ones remain", () => {
    const course = makeCourse([
      section("LEC", "LEC0101"),
      section("LEC", "LEC0201"),
      section("TUT", "TUT0101", { linkedMeetingSections: [linked("LEC", "0101")] }),
      // Name order would pick TUT0201, but it is waitlisted; TUT0202 wins.
      section("TUT", "TUT0201", {
        linkedMeetingSections: [linked("LEC", "0201")],
        waitlistInd: "Y",
        currentEnrolment: 30,
        maxEnrolment: 30,
      }),
      section("TUT", "TUT0202", { linkedMeetingSections: [linked("LEC", "0201")] }),
    ]);

    const impact = linkageImpact(
      course,
      "CSC207H1:F",
      { LEC: "LEC0101", TUT: "TUT0101" },
      "LEC",
      course.sections[1]!,
      [],
    );

    expect(impact).toEqual({
      clears: ["TUT"],
      autoPicks: [{ teachMethod: "TUT", sectionName: "TUT0202" }],
    });
  });

  it("prefers a replacement that does not conflict with the rest of the plan or the new section", () => {
    const course = makeCourse([
      section("LEC", "LEC0101"),
      section("LEC", "LEC0201", {
        meetingTimes: [meeting(1, "10:00", "11:00", "BA")],
      }),
      section("TUT", "TUT0101", { linkedMeetingSections: [linked("LEC", "0101")] }),
      // Name order would pick TUT0201, but it overlaps the new LEC0201.
      section("TUT", "TUT0201", {
        linkedMeetingSections: [linked("LEC", "0201")],
        meetingTimes: [meeting(1, "10:00", "11:00", "MP")],
      }),
      section("TUT", "TUT0202", {
        linkedMeetingSections: [linked("LEC", "0201")],
        meetingTimes: [meeting(1, "11:00", "12:00", "MP")],
      }),
    ]);

    const impact = linkageImpact(
      course,
      "CSC207H1:F",
      { LEC: "LEC0101", TUT: "TUT0101" },
      "LEC",
      course.sections[1]!,
      [],
    );

    expect(impact).toEqual({
      clears: ["TUT"],
      autoPicks: [{ teachMethod: "TUT", sectionName: "TUT0202" }],
    });
  });
});

describe("walkFromPreviousBlock", () => {
  it("uses the nearest earlier block within thirty minutes on the same day", () => {
    const walk = walkFromPreviousBlock(
      [
        block({ id: "early", day: 1, endMillis: hhmmToMillis("09:30"), buildingCode: "SS" }),
        block({ id: "near", day: 1, endMillis: hhmmToMillis("10:00"), buildingCode: "BA" }),
        block({ id: "other-day", day: 2, endMillis: hhmmToMillis("10:00"), buildingCode: "AH" }),
      ],
      { day: 1, startMillis: hhmmToMillis("10:15") },
      "MP",
    );

    expect(walk).toEqual({ fromCode: "BA", minutes: 5 });
  });

  it("returns null when no previous block is close enough", () => {
    const walk = walkFromPreviousBlock(
      [block({ day: 1, endMillis: hhmmToMillis("09:00"), buildingCode: "BA" })],
      { day: 1, startMillis: hhmmToMillis("10:00") },
      "MP",
    );

    expect(walk).toBeNull();
  });
});

describe("buildAlternativeDraftBlocks", () => {
  it("builds one dashed draft per slot group with invalidated section keys", () => {
    const course = makeCourse([
      section("LEC", "LEC0101", {
        meetingTimes: [meeting(1, "09:00", "10:00", "BA")],
      }),
      section("LEC", "LEC0201", {
        meetingTimes: [meeting(1, "10:00", "11:00", "MP")],
      }),
      section("TUT", "TUT0101", { linkedMeetingSections: [linked("LEC", "0101")] }),
      section("TUT", "TUT0201", { linkedMeetingSections: [linked("LEC", "0201")] }),
    ]);

    const drafts = buildAlternativeDraftBlocks(
      course,
      "CSC207H1:F",
      "LEC",
      { LEC: "LEC0101", TUT: "TUT0101" },
      "fall",
      [],
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      id: "draft:CSC207H1:F:LEC:1:36000000",
      draft: true,
      draftOptions: ["LEC0201"],
      draftInvalidatesSectionKeys: ["CSC207H1:F:TUT:TUT0101"],
      sectionName: "LEC0201",
      room: "MP 101",
      buildingCode: "MP",
      preview: false,
      disallowed: false,
    });
  });

  it("collapses same-slot options and marks the draft waitlisted only when all options are waitlisted", () => {
    const course = makeCourse([
      section("TUT", "TUT0101"),
      section("TUT", "TUT0201", {
        meetingTimes: [meeting(2, "13:00", "14:00", "BA")],
        waitlistInd: "Y",
        currentEnrolment: 30,
        maxEnrolment: 30,
      }),
      section("TUT", "TUT0202", {
        meetingTimes: [meeting(2, "13:00", "14:00", "MP")],
        waitlistInd: "Y",
        currentEnrolment: 30,
        maxEnrolment: 30,
      }),
    ]);

    const drafts = buildAlternativeDraftBlocks(
      course,
      "CSC207H1:F",
      "TUT",
      { TUT: "TUT0101" },
      "fall",
      [],
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.sectionName).toBe("2 options");
    expect(drafts[0]?.draftOptions).toEqual(["TUT0201", "TUT0202"]);
    expect(drafts[0]?.waitlisted).toBe(true);
  });
});

function makeCourse(sections: Section[], sectionCode: SectionCode = "F"): Course {
  return {
    id: "course-1",
    code: "CSC207H1",
    sectionCode,
    name: "Software Design",
    campus: "St. George",
    sessions: ["20269"],
    faculty: { code: "ARTSC", name: "Faculty of Arts and Science" },
    department: { code: "CSC", name: "Computer Science" },
    maxCredit: 0.5,
    minCredit: 0.5,
    breadths: [],
    notes: [],
    cmCourseInfo: null,
    sections,
    primaryTeachMethod: "LEC",
    fullyOnline: false,
    primaryWaitlistable: false,
    primaryFull: false,
    cancelInd: "N",
  };
}

function section(
  teachMethod: TeachMethod,
  name: string,
  overrides: Partial<Section> = {},
): Section {
  return {
    name,
    type: "Lecture",
    teachMethod,
    sectionNumber: name.replace(/\D/g, ""),
    meetingTimes: [],
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
    ...overrides,
  };
}

function meeting(
  day: DayNumber,
  start: string,
  end: string,
  buildingCode: string,
): MeetingTime {
  return {
    start: { day, millisofday: hhmmToMillis(start) },
    end: { day, millisofday: hhmmToMillis(end) },
    building: {
      buildingCode,
      buildingRoomNumber: "101",
      buildingRoomSuffix: "",
      buildingUrl: "",
      buildingName: null,
    },
    sessionCode: "20269",
    repetitionTime: "ONCE_A_WEEK",
  };
}

function linked(teachMethod: string, sectionNumber: string): LinkedMeetingSection {
  return { teachMethod, sectionNumber, type: null };
}

function block(overrides: Partial<TimetableBlock>): TimetableBlock {
  return {
    id: "block",
    sectionKey: "MAT137Y1:Y:LEC:LEC0101",
    courseKey: "MAT137Y1:Y",
    courseCode: "MAT137Y1",
    courseName: "Calculus",
    teachMethod: "LEC",
    sectionName: "LEC0101",
    room: "BA 1130",
    buildingCode: "BA",
    day: 1,
    startMillis: hhmmToMillis("09:00"),
    endMillis: hhmmToMillis("10:00"),
    color: "#2563eb",
    conflict: false,
    disallowed: false,
    preview: false,
    waitlisted: false,
    ...overrides,
  };
}

function hhmmToMillis(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return ((hours ?? 0) * 60 + (minutes ?? 0)) * 60_000;
}
