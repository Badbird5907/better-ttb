import { describe, expect, it } from "vitest";
import type { Course, MeetingTime, Section } from "@better-ttb/shared";

import { buildIcsCalendar, escapeIcsText, foldIcsLine } from "./ics";
import type { SelectedTimetableSection } from "./timetable";

describe("ics generation", () => {
  it("uses CRLF, folds long lines, and escapes text", () => {
    const selected = selectedSection({
      courseName:
        "A very long course name, with commas; semicolons; backslashes \\ and a newline\nthat forces folding in the exported description",
    });
    const ics = buildIcsCalendar({
      calendarName: "Fall, Plan; One",
      selectedSections: [selected],
      now: new Date("2026-07-11T12:00:00Z"),
    });

    expect(ics).toContain("\r\n");
    expect(ics).toContain("X-WR-CALNAME:Fall\\, Plan\\; One");
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("DTSTART;TZID=America/Toronto:20260908T090000");
    expect(ics).toContain("DESCRIPTION:A very long course name\\, with commas\\; semicolons\\;");
    expect(ics.split("\r\n").filter(Boolean).every((line) => line.length <= 75)).toBe(true);
  });

  it("exports alternating week meetings with interval 2 and adjusted second-week start", () => {
    const selected = selectedSection({
      meeting: makeMeeting("SECOND_AND_FOURTH_WEEK"),
    });
    const ics = buildIcsCalendar({
      calendarName: "Winter",
      selectedSections: [selected],
      now: new Date("2026-07-11T12:00:00Z"),
    });

    expect(ics).toContain("DTSTART;TZID=America/Toronto:20260915T090000");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261208T235959Z");
  });

  it("exposes compliant line folding and text escaping helpers", () => {
    expect(foldIcsLine(`SUMMARY:${"A".repeat(90)}`)).toContain("\r\n ");
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });
});

function selectedSection({
  courseName = "Computer Programming",
  meeting = makeMeeting("ONCE_A_WEEK"),
}: {
  courseName?: string;
  meeting?: MeetingTime;
} = {}): SelectedTimetableSection {
  const section = makeSection([meeting]);
  const course = makeCourse(courseName, section);

  return {
    key: "CSC108H1:F:LEC:LEC0101",
    courseKey: "CSC108H1:F",
    course,
    pinned: {
      courseCode: "CSC108H1",
      sectionCode: "F",
      chosen: { LEC: "LEC0101" },
    },
    teachMethod: "LEC",
    section,
  };
}

function makeCourse(name: string, section: Section): Course {
  return {
    id: "CSC108H1-F",
    code: "CSC108H1",
    sectionCode: "F",
    name,
    campus: "UTSG",
    sessions: ["20269"],
    faculty: { code: "ARTSC", name: "Arts and Science" },
    department: { code: "CSC", name: "Computer Science" },
    maxCredit: 0.5,
    minCredit: 0.5,
    breadths: [],
    notes: [],
    cmCourseInfo: {
      description: null,
      prerequisitesText: null,
      corequisitesText: null,
      exclusionsText: null,
      recommendedPreparation: null,
      levelOfInstruction: "100",
      breadthRequirements: [],
      distributionRequirements: [],
      division: "ARTSC",
    },
    sections: [section],
    primaryTeachMethod: "LEC",
    fullyOnline: false,
    primaryWaitlistable: false,
    primaryFull: false,
    cancelInd: "N",
  };
}

function makeSection(meetings: MeetingTime[]): Section {
  return {
    name: "LEC0101",
    type: "LEC",
    teachMethod: "LEC",
    sectionNumber: "0101",
    meetingTimes: meetings,
    instructors: [],
    currentEnrolment: 10,
    maxEnrolment: 100,
    currentWaitlist: 0,
    waitlistInd: "N",
    cancelInd: "N",
    enrolmentInd: "Y",
    tbaInd: "N",
    openLimitInd: "N",
    deliveryModes: [{ session: "20269", mode: "INPER" }],
    subTitle: "",
    notes: [],
    enrolmentControls: [],
    linkedMeetingSections: null,
  };
}

function makeMeeting(repetitionTime: MeetingTime["repetitionTime"]): MeetingTime {
  return {
    start: { day: 2, millisofday: 9 * 60 * 60 * 1000 },
    end: { day: 2, millisofday: 10 * 60 * 60 * 1000 },
    building: {
      buildingCode: "BA",
      buildingRoomNumber: "1170",
      buildingRoomSuffix: "",
      buildingUrl: "",
      buildingName: "Bahen Centre",
    },
    sessionCode: "20269",
    repetition: "",
    repetitionTime,
  };
}
