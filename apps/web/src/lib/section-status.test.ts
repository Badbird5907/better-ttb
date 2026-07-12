import type { Course, LinkedMeetingSection, Section, TeachMethod } from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import { getSectionAvailability, selectedOthersFor } from "./section-status";

const CANCELLED_REASON =
  "Activity cancelled: This activity is not available for selection because it has been cancelled.";
const UNAVAILABLE_REASON =
  "Activity unavailable: This activity is currently unavailable. Please check back again later.";
const LINKAGE_REASON =
  "Activity unavailable: This activity is not available for selection because it must be taken together with a different activity.";
const TBA_HINT = "This section doesn't have a day and time specified yet.";

describe("getSectionAvailability", () => {
  it("allows a plain, unconstrained section", () => {
    const result = getSectionAvailability(section("LEC", "LEC0101"), []);

    expect(result).toEqual({ disabled: false });
  });

  it("disables a cancelled section", () => {
    const result = getSectionAvailability(section("LEC", "LEC0101", { cancelInd: "Y" }), []);

    expect(result).toEqual({ disabled: true, reason: CANCELLED_REASON });
  });

  it("disables an unavailable (closed limit) section", () => {
    const result = getSectionAvailability(
      section("LEC", "LEC0101", { openLimitInd: "C" }),
      [],
    );

    expect(result).toEqual({ disabled: true, reason: UNAVAILABLE_REASON });
  });

  it("disables a section that violates linkage", () => {
    // TUT0301 links to LEC0201, but LEC0101 is the selected lecture.
    const candidate = section("TUT", "TUT0301", { linkedMeetingSections: [linked("LEC", "0201")] });
    const result = getSectionAvailability(candidate, [section("LEC", "LEC0101")]);

    expect(result).toEqual({ disabled: true, reason: LINKAGE_REASON });
  });

  it("allows a section that satisfies linkage", () => {
    const candidate = section("TUT", "TUT0201", { linkedMeetingSections: [linked("LEC", "0101")] });
    const result = getSectionAvailability(candidate, [section("LEC", "LEC0101")]);

    expect(result).toEqual({ disabled: false });
  });

  it("does not disable a TBA section but carries the hint", () => {
    const result = getSectionAvailability(section("LEC", "LEC0101", { tbaInd: "Y" }), []);

    expect(result).toEqual({ disabled: false, hint: TBA_HINT });
  });

  it("cancelled wins over closed limit (priority order)", () => {
    const result = getSectionAvailability(
      section("LEC", "LEC0101", { cancelInd: "Y", openLimitInd: "C" }),
      [],
    );

    expect(result.reason).toBe(CANCELLED_REASON);
  });

  it("closed limit wins over linkage violation (priority order)", () => {
    const candidate = section("TUT", "TUT0301", {
      openLimitInd: "C",
      linkedMeetingSections: [linked("LEC", "0201")],
    });
    const result = getSectionAvailability(candidate, [section("LEC", "LEC0101")]);

    expect(result.reason).toBe(UNAVAILABLE_REASON);
  });

  it("keeps the TBA hint on a disabled section", () => {
    const result = getSectionAvailability(
      section("LEC", "LEC0101", { cancelInd: "Y", tbaInd: "Y" }),
      [],
    );

    expect(result).toEqual({ disabled: true, reason: CANCELLED_REASON, hint: TBA_HINT });
  });
});

describe("selectedOthersFor", () => {
  const course = makeCourse([
    section("LEC", "LEC0101"),
    section("LEC", "LEC0201"),
    section("TUT", "TUT0101"),
    section("PRA", "PRA0101"),
  ]);

  it("resolves chosen sections of other teach methods", () => {
    const others = selectedOthersFor(
      course,
      { LEC: "LEC0201", TUT: "TUT0101", PRA: "PRA0101" },
      "TUT",
    );

    expect(others.map((s) => s.name).sort()).toEqual(["LEC0201", "PRA0101"]);
  });

  it("skips the target teach method, null/empty choices, and unresolved names", () => {
    const others = selectedOthersFor(
      course,
      { LEC: "LEC0101", TUT: null, PRA: "", XXX: "DOES-NOT-EXIST" },
      "TUT",
    );

    expect(others.map((s) => s.name)).toEqual(["LEC0101"]);
  });
});

function makeCourse(sections: Section[]): Course {
  return {
    id: "course-1",
    code: "CSC207H1",
    sectionCode: "F",
    name: "Software Design",
    campus: "St. George",
    sessions: ["20269"],
    faculty: { code: "ARTSC", name: "Faculty of Arts and Science" },
    department: { code: "CS", name: "Computer Science" },
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
  } as unknown as Course;
}

function linked(teachMethod: string, sectionNumber: string): LinkedMeetingSection {
  return { teachMethod, sectionNumber, type: null };
}

function section(
  teachMethod: TeachMethod,
  sectionName: string,
  overrides: Partial<Section> = {},
): Section {
  return {
    name: sectionName,
    type: "Lecture",
    teachMethod,
    sectionNumber: sectionName.replace(/\D/g, ""),
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
