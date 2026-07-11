import type {
  Course,
  DayNumber,
  DeliveryMode,
  MeetingTime,
  Section,
  SectionCode,
} from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEARCH_FILTERS,
  createCourseSearch,
  searchCourses,
} from "./search";

describe("course search", () => {
  it("indexes course text and applies the filter pipeline", () => {
    const courses = [
      makeCourse({
        code: "CSC108H1",
        sectionCode: "F",
        name: "Introduction to Computer Programming",
        departmentCode: "CSC",
        breadthCode: "BR=5",
        instructor: "Ada Lovelace",
        deliveryMode: "INPER",
        day: 1,
        currentEnrolment: 45,
        maxEnrolment: 120,
        waitlistInd: "Y",
        description: "<p>Learn programming with Python.</p>",
      }),
      makeCourse({
        code: "MAT135H1",
        sectionCode: "S",
        name: "Calculus I",
        departmentCode: "MAT",
        breadthCode: "BR=1",
        instructor: "Emmy Noether",
        deliveryMode: "SYNC",
        day: 2,
        currentEnrolment: 100,
        maxEnrolment: 100,
        waitlistInd: "N",
        description: "<p>Differential calculus.</p>",
      }),
    ];
    const index = createCourseSearch(courses);

    expect(
      searchCourses(index, "program", DEFAULT_SEARCH_FILTERS).map(
        (course) => course.code,
      ),
    ).toEqual(["CSC108H1"]);

    expect(
      searchCourses(index, "", {
        ...DEFAULT_SEARCH_FILTERS,
        departments: ["CSC"],
        levels: ["100"],
        sectionCodes: ["F"],
        deliveryModes: ["INPER"],
        creditWeights: [0.5],
        breadthCodes: ["BR=5"],
        instructor: "lovelace",
        days: [1],
        availableSpace: true,
        waitlistable: true,
      }).map((course) => course.code),
    ).toEqual(["CSC108H1"]);
  });
});

function makeCourse({
  code,
  sectionCode,
  name,
  departmentCode,
  breadthCode,
  instructor,
  deliveryMode,
  day,
  currentEnrolment,
  maxEnrolment,
  waitlistInd,
  description,
}: {
  code: string;
  sectionCode: SectionCode;
  name: string;
  departmentCode: string;
  breadthCode: string;
  instructor: string;
  deliveryMode: DeliveryMode;
  day: DayNumber;
  currentEnrolment: number;
  maxEnrolment: number;
  waitlistInd: "Y" | "N";
  description: string;
}): Course {
  return {
    id: `${code}-${sectionCode}`,
    code,
    sectionCode,
    name,
    campus: "St. George",
    sessions: ["20269"],
    faculty: { code: "ARTSC", name: "Arts & Science" },
    department: { code: departmentCode, name: departmentCode },
    maxCredit: 0.5,
    minCredit: 0.5,
    breadths: [{ breadthTypes: [{ code: breadthCode }] }],
    notes: [],
    cmCourseInfo: {
      description,
      prerequisitesText: null,
      corequisitesText: null,
      exclusionsText: null,
      recommendedPreparation: null,
      levelOfInstruction: "undergraduate",
      breadthRequirements: [],
      distributionRequirements: [],
      division: "ARTSC",
    },
    sections: [
      makeSection({
        name: "LEC0101",
        teachMethod: "LEC",
        instructor,
        deliveryMode,
        day,
        currentEnrolment,
        maxEnrolment,
        waitlistInd,
      }),
    ],
    primaryTeachMethod: "LEC",
    fullyOnline: deliveryMode !== "INPER",
    primaryWaitlistable: waitlistInd === "Y",
    primaryFull: currentEnrolment >= maxEnrolment,
    cancelInd: "N",
  };
}

function makeSection({
  name,
  teachMethod,
  instructor,
  deliveryMode,
  day,
  currentEnrolment,
  maxEnrolment,
  waitlistInd,
}: {
  name: string;
  teachMethod: string;
  instructor: string;
  deliveryMode: DeliveryMode;
  day: DayNumber;
  currentEnrolment: number;
  maxEnrolment: number;
  waitlistInd: "Y" | "N";
}): Section {
  const [firstName = "", lastName = ""] = instructor.split(" ");

  return {
    name,
    type: "Lecture",
    teachMethod,
    sectionNumber: "0101",
    meetingTimes: [makeMeeting(day)],
    instructors: [{ firstName, lastName }],
    currentEnrolment,
    maxEnrolment,
    currentWaitlist: waitlistInd === "Y" ? 5 : 0,
    waitlistInd,
    cancelInd: "N",
    enrolmentInd: "Y",
    tbaInd: "N",
    openLimitInd: "N",
    deliveryModes: [{ session: "20269", mode: deliveryMode }],
    subTitle: "",
    notes: [],
    enrolmentControls: [],
    linkedMeetingSections: null,
  };
}

function makeMeeting(day: DayNumber): MeetingTime {
  return {
    start: { day, millisofday: 10 * 60 * 60 * 1000 },
    end: { day, millisofday: 11 * 60 * 60 * 1000 },
    building: {
      buildingCode: "BA",
      buildingRoomNumber: "1130",
      buildingRoomSuffix: "",
      buildingUrl: "",
      buildingName: "Bahen Centre",
    },
    sessionCode: "20269",
    repetitionTime: "ONCE_A_WEEK",
  };
}
