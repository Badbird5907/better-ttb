import type {
  Course,
  TtbPageableCourse,
  TtbPageableCoursesResponse,
} from "@better-ttb/shared";

export const csc108Course: Course = {
  id: "69dd-csc108-f-20269",
  code: "CSC108H1",
  sectionCode: "F",
  name: "Introduction to Computer Programming",
  campus: "St. George",
  sessions: ["20269"],
  faculty: {
    code: "ARTSC",
    name: "Faculty of Arts and Science",
  },
  department: {
    code: "CSC",
    name: "Computer Science",
  },
  maxCredit: 0.5,
  minCredit: 0.5,
  cancelInd: "N",
  breadths: [
    {
      breadthTypes: [
        {
          kind: "BREADTH",
          type: "The Physical and Mathematical Universes",
          code: "BR=5",
          description: "The Physical and Mathematical Universes",
        },
      ],
    },
  ],
  notes: [
    {
      name: "Course Note",
      type: "COURSE",
      content: "<p>Students may not enrol in this course after CSC148H1.</p>",
    },
  ],
  cmCourseInfo: {
    description:
      "Programming in a language such as Python. Elementary data types, lists, maps, program design, testing and debugging.",
    prerequisitesText: null,
    corequisitesText: null,
    exclusionsText: "CSC110Y1, CSC120H1, CSC121H1, CSC148H1",
    recommendedPreparation: null,
    levelOfInstruction: "undergraduate",
    breadthRequirements: ["The Physical and Mathematical Universes (5)"],
    distributionRequirements: ["Science"],
    division: "Faculty of Arts and Science",
  },
  sections: [
    {
      name: "LEC0101",
      type: "Lecture",
      teachMethod: "LEC",
      sectionNumber: "0101",
      meetingTimes: [
        {
          start: {
            day: 1,
            millisofday: 36000000,
          },
          end: {
            day: 1,
            millisofday: 46800000,
          },
          building: {
            buildingCode: "WW",
            buildingRoomNumber: "120",
            buildingRoomSuffix: "",
            buildingUrl: "https://map.utoronto.ca/?id=1809#!m/494523",
            buildingName: null,
          },
          sessionCode: "20269",
          repetition: "WEEKLY",
          repetitionTime: "ONCE_A_WEEK",
        },
      ],
      instructors: [
        {
          firstName: "Diane",
          lastName: "Horton",
        },
      ],
      currentEnrolment: 5,
      maxEnrolment: 30,
      currentWaitlist: 0,
      waitlistInd: "N",
      cancelInd: "N",
      enrolmentInd: "E",
      tbaInd: "N",
      openLimitInd: "N",
      deliveryModes: [
        {
          session: "20269",
          mode: "INPER",
        },
      ],
      subTitle: "",
      notes: [
        {
          name: "Section Note",
          type: "SECTION",
          content: "",
        },
      ],
      enrolmentControls: [
        {
          yearOfStudy: "*",
          post: {
            code: "ASMAJ1689",
            name: "Computer Science Major",
          },
          subject: {
            code: "CSC",
            name: "Computer Science",
          },
          quantity: 30,
          sequence: 1,
        },
      ],
      linkedMeetingSections: null,
    },
  ],
  primaryTeachMethod: "LEC",
  fullyOnline: false,
  primaryWaitlistable: false,
  primaryFull: false,
};

export const csc108PageableCourse: TtbPageableCourse = {
  courses: [csc108Course],
  total: 3751,
  page: 1,
  pageSize: 20,
  direction: "asc",
};

export const csc108PageableResponse: TtbPageableCoursesResponse = {
  payload: {
    pageableCourse: csc108PageableCourse,
  },
  status: [],
};
