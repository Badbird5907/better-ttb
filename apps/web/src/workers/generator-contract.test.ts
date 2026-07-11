import { describe, expect, it } from "vitest";
import type { Course, MeetingTime, Section } from "@better-ttb/shared";

import {
  createDoneMessage,
  createStartedMessage,
  type GeneratorWorkerRequest,
} from "./generator-contract";

describe("generator worker contract", () => {
  it("maps a generate request to started and done messages", () => {
    const request: GeneratorWorkerRequest = {
      type: "generate",
      id: "request-1",
      courses: [{ course: makeCourse() }],
      config: { rules: [], maxResults: 5 },
    };

    expect(createStartedMessage(request)).toEqual({
      type: "started",
      id: "request-1",
    });

    const done = createDoneMessage(request);

    expect(done.type).toBe("done");
    expect(done.id).toBe("request-1");
    expect(done.result.candidates).toHaveLength(1);
    expect(done.result.candidates[0]?.selections).toEqual([
      { courseCode: "CSC108H1", teachMethod: "LEC", sectionName: "LEC0101" },
    ]);
  });
});

function makeCourse(): Course {
  return {
    id: "CSC108H1-F",
    code: "CSC108H1",
    sectionCode: "F",
    name: "Computer Programming",
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
    sections: [makeSection()],
    primaryTeachMethod: "LEC",
    fullyOnline: false,
    primaryWaitlistable: false,
    primaryFull: false,
    cancelInd: "N",
  };
}

function makeSection(): Section {
  return {
    name: "LEC0101",
    type: "LEC",
    teachMethod: "LEC",
    sectionNumber: "0101",
    meetingTimes: [makeMeeting()],
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

function makeMeeting(): MeetingTime {
  return {
    start: { day: 1, millisofday: 9 * 60 * 60 * 1000 },
    end: { day: 1, millisofday: 10 * 60 * 60 * 1000 },
    building: {
      buildingCode: "BA",
      buildingRoomNumber: "1170",
      buildingRoomSuffix: "",
      buildingUrl: "",
      buildingName: "Bahen Centre",
    },
    sessionCode: "20269",
    repetition: "",
    repetitionTime: "ONCE_A_WEEK",
  };
}
