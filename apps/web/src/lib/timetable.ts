import { detectConflicts, type CandidateTimetable, type CourseInput } from "@better-ttb/generator";
import type {
  Course,
  DayNumber,
  MeetingTime,
  Section,
  TeachMethod,
} from "@better-ttb/shared";
import { parseSessionCode } from "@better-ttb/shared";

import type { PinnedCourse, Plan } from "@/stores/plan";

export type Term = "fall" | "winter";

export interface SelectedTimetableSection {
  key: string;
  courseKey: string;
  course: Course;
  pinned: PinnedCourse;
  teachMethod: TeachMethod;
  section: Section;
}

export interface TimetableBlock {
  id: string;
  sectionKey: string;
  courseKey: string;
  courseCode: string;
  courseName: string;
  teachMethod: TeachMethod;
  sectionName: string;
  room: string;
  day: DayNumber;
  startMillis: number;
  endMillis: number;
  color: string;
  conflict: boolean;
  preview: boolean;
}

export interface UnscheduledSection {
  key: string;
  courseCode: string;
  courseName: string;
  teachMethod: TeachMethod;
  sectionName: string;
  reason: string;
}

export interface CreditTotals {
  fall: number;
  winter: number;
}

const COURSE_PALETTE = [
  "#2563eb",
  "#059669",
  "#dc2626",
  "#7c3aed",
  "#d97706",
  "#0891b2",
  "#be123c",
  "#4f46e5",
  "#16a34a",
  "#c2410c",
  "#0f766e",
  "#9333ea",
];

export function pinnedKey(pinned: Pick<PinnedCourse, "courseCode" | "sectionCode">): string {
  return `${pinned.courseCode}:${pinned.sectionCode}`;
}

export function courseKey(course: Pick<Course, "code" | "sectionCode">): string {
  return `${course.code}:${course.sectionCode}`;
}

export function getActivePlanCourses(
  plan: Plan,
  coursesByKey: Map<string, Course>,
): Course[] {
  return plan.pinned
    .map((pinned) => coursesByKey.get(pinnedKey(pinned)))
    .filter((course): course is Course => Boolean(course));
}

export function selectedSectionsFromPlan(
  plan: Plan,
  coursesByKey: Map<string, Course>,
): SelectedTimetableSection[] {
  return plan.pinned.flatMap((pinned) => {
    const course = coursesByKey.get(pinnedKey(pinned));

    if (!course) {
      return [];
    }

    return Object.entries(pinned.chosen).flatMap(([teachMethod, sectionName]) => {
      if (!sectionName) {
        return [];
      }

      const section = course.sections.find(
        (candidate) =>
          candidate.teachMethod === teachMethod && candidate.name === sectionName,
      );

      if (!section) {
        return [];
      }

      return [
        {
          key: selectedSectionKey(pinned, teachMethod, section.name),
          courseKey: pinnedKey(pinned),
          course,
          pinned,
          teachMethod,
          section,
        },
      ];
    });
  });
}

export function selectedSectionsFromCandidate(
  plan: Plan,
  coursesByKey: Map<string, Course>,
  candidate: CandidateTimetable,
): SelectedTimetableSection[] {
  return candidate.selections.flatMap((selection) => {
    const matchingPinned = plan.pinned.find((pinned) => {
      if (pinned.courseCode !== selection.courseCode) {
        return false;
      }

      const course = coursesByKey.get(pinnedKey(pinned));
      return Boolean(
        course?.sections.some(
          (section) =>
            section.teachMethod === selection.teachMethod &&
            section.name === selection.sectionName,
        ),
      );
    });

    if (!matchingPinned) {
      return [];
    }

    const course = coursesByKey.get(pinnedKey(matchingPinned));
    const section = course?.sections.find(
      (candidateSection) =>
        candidateSection.teachMethod === selection.teachMethod &&
        candidateSection.name === selection.sectionName,
    );

    if (!course || !section) {
      return [];
    }

    return [
      {
        key: selectedSectionKey(matchingPinned, selection.teachMethod, selection.sectionName),
        courseKey: pinnedKey(matchingPinned),
        course,
        pinned: matchingPinned,
        teachMethod: selection.teachMethod,
        section,
      },
    ];
  });
}

export function buildTermBlocks(
  selectedSections: readonly SelectedTimetableSection[],
  term: Term,
  options: { preview?: boolean } = {},
): { blocks: TimetableBlock[]; unscheduled: UnscheduledSection[] } {
  const conflictSectionKeys = detectTermConflictSectionKeys(selectedSections, term);
  const blocks: TimetableBlock[] = [];
  const unscheduled: UnscheduledSection[] = [];

  selectedSections.forEach((selectedSection) => {
    if (!courseAppliesToTerm(selectedSection.course.sectionCode, term)) {
      return;
    }

    const meetings = activeMeetingsForTerm(selectedSection.section, term);

    if (meetings.length === 0) {
      unscheduled.push({
        key: selectedSection.key,
        courseCode: selectedSection.course.code,
        courseName: selectedSection.course.name,
        teachMethod: selectedSection.teachMethod,
        sectionName: selectedSection.section.name,
        reason: selectedSection.section.tbaInd === "Y" ? "TBA" : "no meeting times",
      });
      return;
    }

    meetings.forEach((meeting, index) => {
      blocks.push({
        id: `${selectedSection.key}:${index}`,
        sectionKey: selectedSection.key,
        courseKey: selectedSection.courseKey,
        courseCode: selectedSection.course.code,
        courseName: selectedSection.course.name,
        teachMethod: selectedSection.teachMethod,
        sectionName: selectedSection.section.name,
        room: formatRoom(meeting),
        day: meeting.start.day,
        startMillis: meeting.start.millisofday,
        endMillis: meeting.end.millisofday,
        color: colorForCourse(selectedSection.course.code),
        conflict: conflictSectionKeys.has(selectedSection.key),
        preview: options.preview ?? false,
      });
    });
  });

  return { blocks, unscheduled };
}

export function computeCreditTotals(
  plan: Plan,
  coursesByKey: Map<string, Course>,
): CreditTotals {
  return plan.pinned.reduce<CreditTotals>(
    (totals, pinned) => {
      const course = coursesByKey.get(pinnedKey(pinned));

      if (!course) {
        return totals;
      }

      if (course.sectionCode === "F") {
        return { ...totals, fall: totals.fall + course.maxCredit };
      }

      if (course.sectionCode === "S") {
        return { ...totals, winter: totals.winter + course.maxCredit };
      }

      return {
        fall: totals.fall + course.maxCredit / 2,
        winter: totals.winter + course.maxCredit / 2,
      };
    },
    { fall: 0, winter: 0 },
  );
}

export function buildGeneratorCourseInputs(
  plan: Plan,
  coursesByKey: Map<string, Course>,
  lockedCourseKeys: readonly string[],
): CourseInput[] {
  const locked = new Set(lockedCourseKeys);

  return plan.pinned.flatMap((pinned) => {
    const course = coursesByKey.get(pinnedKey(pinned));

    if (!course) {
      return [];
    }

    const input: CourseInput = { course };

    if (locked.has(pinnedKey(pinned))) {
      const lockedChoices = Object.fromEntries(
        Object.entries(pinned.chosen).filter((entry): entry is [TeachMethod, string] =>
          typeof entry[1] === "string" && entry[1].length > 0,
        ),
      );

      if (Object.keys(lockedChoices).length > 0) {
        input.locked = lockedChoices;
      }
    }

    return [input];
  });
}

export function applyCandidateSelections(
  plan: Plan,
  coursesByKey: Map<string, Course>,
  candidate: CandidateTimetable,
): Array<{
  courseCode: string;
  sectionCode: Course["sectionCode"];
  teachMethod: TeachMethod;
  sectionName: string;
}> {
  return selectedSectionsFromCandidate(plan, coursesByKey, candidate).map((selection) => ({
    courseCode: selection.course.code,
    sectionCode: selection.course.sectionCode,
    teachMethod: selection.teachMethod,
    sectionName: selection.section.name,
  }));
}

export function courseAppliesToTerm(sectionCode: Course["sectionCode"], term: Term): boolean {
  return (
    sectionCode === "Y" ||
    (sectionCode === "F" && term === "fall") ||
    (sectionCode === "S" && term === "winter")
  );
}

export function activeMeetingsForTerm(section: Section, term: Term): MeetingTime[] {
  if (section.tbaInd === "Y") {
    return [];
  }

  return section.meetingTimes.filter(
    (meeting) =>
      meeting.end.millisofday > meeting.start.millisofday &&
      meetingAppliesToTerm(meeting, term),
  );
}

export function totalWalkMinutes(candidate: CandidateTimetable): number {
  return Object.values(candidate.extras.totalWalkMinutesPerDay).reduce(
    (total, minutes) => total + minutes,
    0,
  );
}

export function daysOnCampusCount(candidate: CandidateTimetable): number {
  return candidate.extras.daysOnCampus.fall.length + candidate.extras.daysOnCampus.winter.length;
}

export function selectedSectionKey(
  pinned: Pick<PinnedCourse, "courseCode" | "sectionCode">,
  teachMethod: TeachMethod,
  sectionName: string,
): string {
  return `${pinnedKey(pinned)}:${teachMethod}:${sectionName}`;
}

export function colorForCourse(courseCode: string): string {
  let hash = 0;

  for (let index = 0; index < courseCode.length; index += 1) {
    hash = (hash * 31 + courseCode.charCodeAt(index)) >>> 0;
  }

  return COURSE_PALETTE[hash % COURSE_PALETTE.length] ?? COURSE_PALETTE[0]!;
}

function detectTermConflictSectionKeys(
  selectedSections: readonly SelectedTimetableSection[],
  term: Term,
): Set<string> {
  const sections = selectedSections
    .filter((selectedSection) =>
      courseAppliesToTerm(selectedSection.course.sectionCode, term),
    )
    .map((selectedSection) => ({
      key: selectedSection.key,
      section: {
        ...selectedSection.section,
        name: selectedSection.key,
        meetingTimes: activeMeetingsForTerm(selectedSection.section, term),
      },
    }))
    .filter((entry) => entry.section.meetingTimes.length > 0);
  const conflicts = detectConflicts(sections.map((entry) => entry.section));
  const keys = new Set<string>();

  conflicts.forEach((conflict) => {
    keys.add(conflict.first);
    keys.add(conflict.second);
  });

  return keys;
}

function meetingAppliesToTerm(meeting: MeetingTime, term: Term): boolean {
  try {
    const parsed = parseSessionCode(meeting.sessionCode);
    return parsed.term === "year" || parsed.term === term;
  } catch {
    return true;
  }
}

function formatRoom(meeting: MeetingTime): string {
  const code = meeting.building.buildingCode;
  const number = meeting.building.buildingRoomNumber;
  const suffix = meeting.building.buildingRoomSuffix;
  const room = `${number}${suffix}`.trim();

  if (!code && !room) {
    return "TBA";
  }

  return `${code}${room ? ` ${room}` : ""}`.trim();
}
