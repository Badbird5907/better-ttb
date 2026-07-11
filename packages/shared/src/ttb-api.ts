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

export type TtbDirection = "asc" | "desc" | string;

export interface TtbStatus {
  code?: number;
  message?: string;
  type?: string;
  [key: string]: unknown;
}

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
  buildingName: string | null;
  [key: string]: unknown;
}

export interface MeetingTime {
  start: MeetingInstant;
  end: MeetingInstant;
  building: MeetingBuilding;
  sessionCode: string;
  repetition?: string;
  repetitionTime: RepetitionTime;
  [key: string]: unknown;
}

export interface Instructor {
  firstName: string;
  lastName: string;
  [key: string]: unknown;
}

export interface SectionDeliveryMode {
  session: string;
  mode: DeliveryMode;
}

export interface Note {
  name: string;
  type: string;
  content: string;
}

export interface EnrolmentControl {
  yearOfStudy?: string;
  post?: CourseUnit;
  subject?: CourseUnit;
  quantity?: number;
  sequence?: number;
  [key: string]: unknown;
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
  enrolmentInd: string;
  tbaInd: string;
  openLimitInd: string;
  deliveryModes: SectionDeliveryMode[];
  subTitle: string;
  notes: Note[];
  enrolmentControls: EnrolmentControl[];
  linkedMeetingSections: unknown[] | null;
  [key: string]: unknown;
}

export interface CourseUnit {
  code: string;
  name: string;
  [key: string]: unknown;
}

export interface CourseInfo {
  description: string | null;
  prerequisitesText: string | null;
  corequisitesText: string | null;
  exclusionsText: string | null;
  recommendedPreparation: string | null;
  levelOfInstruction: string;
  breadthRequirements: string[];
  distributionRequirements: string[];
  division: string;
  [key: string]: unknown;
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
  breadths: Array<Record<string, unknown>>;
  notes: Note[];
  cmCourseInfo: CourseInfo | null;
  sections: Section[];
  primaryTeachMethod: string;
  fullyOnline: boolean;
  primaryWaitlistable: boolean;
  primaryFull: boolean;
  cancelInd: string;
  [key: string]: unknown;
}

export interface TtbPageableCourse {
  courses: Course[];
  total: number;
  page: number;
  pageSize: number;
  direction: TtbDirection;
}

export interface TtbPageableCoursesPayload {
  pageableCourse: TtbPageableCourse;
}

export interface TtbResponse<TPayload> {
  payload: TPayload | null;
  status: TtbStatus[];
}

export type TtbPageableCoursesResponse = TtbResponse<TtbPageableCoursesPayload>;

export type TtbCourseLookupPayload =
  | Course
  | Course[]
  | {
      course?: Course;
      courses?: Course[];
      [key: string]: unknown;
    };

export type TtbCourseLookupResponse = TtbResponse<TtbCourseLookupPayload>;

export type TtbReferenceDataPayload = Record<string, unknown>;

export type TtbReferenceDataResponse = TtbResponse<TtbReferenceDataPayload>;

export interface TtbCourseSearchBody {
  courseCodeAndTitleProps: {
    courseCode: string;
    courseTitle: string;
    courseSectionCode: string;
    searchCourseDescription: boolean;
  };
  departmentProps: unknown[];
  campuses: string[];
  sessions: string[];
  requirementProps: unknown[];
  instructor: string;
  courseLevels: string[];
  deliveryModes: string[];
  dayPreferences: string[];
  timePreferences: string[];
  divisions: string[];
  creditWeights: string[];
  availableSpace: boolean;
  waitListable: boolean;
  page: number;
  pageSize: number;
  direction: TtbDirection;
}

export interface Building {
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}
