import type {
  Course,
  DayNumber,
  DeliveryMode,
  Instructor,
  LinkedMeetingSection,
  MeetingTime,
  RepetitionTime,
  Section,
  SectionCode,
  TeachMethod,
} from "@better-ttb/shared";

export function ms(hour: number, minute = 0): number {
  return (hour * 60 + minute) * 60 * 1000;
}

export function meeting(
  day: DayNumber,
  startMillis: number,
  endMillis: number,
  options: {
    buildingCode?: string;
    repetitionTime?: RepetitionTime;
    deliverySession?: string;
  } = {},
): MeetingTime {
  const buildingCode = options.buildingCode ?? "BA";

  return {
    start: {
      day,
      millisofday: startMillis,
    },
    end: {
      day,
      millisofday: endMillis,
    },
    building: {
      buildingCode,
      buildingRoomNumber: "101",
      buildingRoomSuffix: "",
      buildingUrl: "",
      buildingName: buildingCode,
    },
    sessionCode: options.deliverySession ?? "20259",
    repetition: "",
    repetitionTime: options.repetitionTime ?? "ONCE_A_WEEK",
  };
}

export function section(
  name: string,
  teachMethod: TeachMethod,
  meetings: MeetingTime[],
  options: {
    cancelInd?: string;
    currentEnrolment?: number;
    maxEnrolment?: number;
    waitlistInd?: "Y" | "N";
    tbaInd?: string;
    deliveryModes?: DeliveryMode[];
    instructors?: Array<Partial<Instructor>>;
    linkedMeetingSections?: LinkedMeetingSection[] | null;
  } = {},
): Section {
  return {
    name,
    type: teachMethod,
    teachMethod,
    sectionNumber: name.replace(/^\D+/, ""),
    meetingTimes: meetings,
    instructors: (options.instructors ?? [{ firstName: "Ada", lastName: "Lovelace" }]).map(
      (instructor) => ({
        firstName: instructor.firstName ?? "Ada",
        lastName: instructor.lastName ?? "Lovelace",
      }),
    ),
    currentEnrolment: options.currentEnrolment ?? 0,
    maxEnrolment: options.maxEnrolment ?? 100,
    currentWaitlist: 0,
    waitlistInd: options.waitlistInd ?? "N",
    cancelInd: options.cancelInd ?? "N",
    enrolmentInd: "Y",
    tbaInd: options.tbaInd ?? "N",
    openLimitInd: "N",
    deliveryModes: (options.deliveryModes ?? ["INPER"]).map((mode) => ({
      session: "20259",
      mode,
    })),
    subTitle: "",
    notes: [],
    enrolmentControls: [],
    linkedMeetingSections: options.linkedMeetingSections !== undefined
      ? options.linkedMeetingSections
      : null,
  };
}

export function course(
  code: string,
  sectionCode: SectionCode,
  sections: Section[],
): Course {
  return {
    id: code,
    code,
    sectionCode,
    name: code,
    campus: "UTSG",
    sessions: ["20259"],
    faculty: {
      code: "ARTSC",
      name: "Arts and Science",
    },
    department: {
      code: "CSC",
      name: "Computer Science",
    },
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
    sections,
    primaryTeachMethod: "LEC",
    fullyOnline: false,
    primaryWaitlistable: false,
    primaryFull: false,
    cancelInd: "N",
  };
}

