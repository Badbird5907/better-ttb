export type DayNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type RepetitionTime =
  | "ONCE_A_WEEK"
  | "MANUAL"
  | "FIRST_AND_THIRD_WEEK"
  | "SECOND_AND_FOURTH_WEEK";

export type TeachMethod = "LEC" | "TUT" | "PRA" | string;

export type DeliveryMode = "INPER" | "SYNC" | "ASYNC" | "HYBR";

export type WaitlistIndicator = "Y" | "N";

export type SectionCode = "F" | "S" | "Y";

export interface MeetingInstant {
  /** 1 = Monday, 7 = Sunday. */
  day: DayNumber;
  millisofday: number;
}

export interface MeetingBuilding {
  buildingCode: string;
  buildingRoomNumber: string;
  buildingRoomSuffix: string;
  buildingUrl: string;
  buildingName: string;
}

export interface MeetingTime {
  start: MeetingInstant;
  end: MeetingInstant;
  building: MeetingBuilding;
  sessionCode: string;
  repetitionTime: RepetitionTime;
}

export interface Instructor {
  firstName: string;
  lastName: string;
}

export interface SectionDeliveryMode {
  session: string;
  mode: DeliveryMode;
}

export interface Section {
  /** Example: LEC0101. */
  name: string;
  type: string;
  teachMethod: TeachMethod;
  sectionNumber: string;
  meetingTimes: MeetingTime[];
  instructors: Instructor[];
  currentEnrolment: number;
  maxEnrolment: number;
  currentWaitlist: number;
  waitlistInd: WaitlistIndicator;
  cancelInd: string;
  tbaInd: string;
  openLimitInd: string;
  deliveryModes: SectionDeliveryMode[];
  subTitle: string;
  notes: string;
  enrolmentControls: string;
  linkedMeetingSections: string;
}

export interface CourseUnit {
  code: string;
  name: string;
}

export interface CourseInfo {
  description: string;
  prerequisitesText: string;
  corequisitesText: string;
  exclusionsText: string;
  recommendedPreparation: string;
  levelOfInstruction: string;
  breadthRequirements: string;
  distributionRequirements: string;
}

export interface Course {
  id: string;
  /** Example: CSC108H1. */
  code: string;
  sectionCode: SectionCode;
  name: string;
  campus: string;
  sessions: string[];
  faculty: CourseUnit;
  department: CourseUnit;
  maxCredit: number;
  minCredit: number;
  breadths: string[];
  notes: string;
  cmCourseInfo: CourseInfo;
  sections: Section[];
  primaryTeachMethod: string;
  fullyOnline: boolean;
  cancelInd: string;
}

export interface Building {
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}
