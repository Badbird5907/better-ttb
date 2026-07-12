import { detectConflicts, type CandidateTimetable, type CourseInput } from "@better-ttb/generator";
import type {
  Course,
  DayNumber,
  MeetingTime,
  Section,
  SectionCode,
  TeachMethod,
} from "@better-ttb/shared";
import { meetingTimesOverlap, parseSessionCode, sectionAllowedByLinkage } from "@better-ttb/shared";

import { isSectionWaitlisted } from "@/lib/section-status";
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
  buildingCode: string;
  day: DayNumber;
  startMillis: number;
  endMillis: number;
  color: string;
  conflict: boolean;
  disallowed: boolean;
  preview: boolean;
  waitlisted: boolean;
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
  options: { preview?: boolean; disallowedSectionKeys?: ReadonlySet<string> } = {},
): { blocks: TimetableBlock[]; unscheduled: UnscheduledSection[] } {
  const conflictSectionKeys = detectTermConflictSectionKeys(selectedSections, term);
  const disallowedSectionKeys = options.disallowedSectionKeys ?? new Set<string>();
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
        buildingCode: meeting.building.buildingCode.trim(),
        day: meeting.start.day,
        startMillis: meeting.start.millisofday,
        endMillis: meeting.end.millisofday,
        color: colorForCourse(selectedSection.course.code),
        conflict: conflictSectionKeys.has(selectedSection.key),
        disallowed: disallowedSectionKeys.has(selectedSection.key),
        preview: options.preview ?? false,
        waitlisted: isSectionWaitlisted(selectedSection.section),
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
): CourseInput[] {
  return plan.pinned.flatMap((pinned) => {
    const course = coursesByKey.get(pinnedKey(pinned));

    if (!course) {
      return [];
    }

    const input: CourseInput = { course };

    // Any section the user explicitly chose is locked automatically; clearing a
    // choice (setting it to Auto) removes it here and lets the generator optimize.
    const lockedChoices = Object.fromEntries(
      Object.entries(pinned.chosen).filter((entry): entry is [TeachMethod, string] =>
        typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );

    if (Object.keys(lockedChoices).length > 0) {
      input.locked = lockedChoices;
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

/**
 * A single chosen section belonging to the current plan, expressed with just
 * the fields the conflict helper needs. `courseKey` identifies the owning
 * pinned course so callers can skip comparing a section against its own course.
 */
export interface PlanSelectedSection {
  courseKey: string;
  courseCode: string;
  sectionCode: SectionCode;
  teachMethod: TeachMethod;
  section: Section;
}

/**
 * Pure conflict check for a single section against the rest of the plan.
 *
 * Returns the first already-selected section (from a course other than
 * `courseKeyToSkip`) whose meeting times overlap `candidate` in a shared term,
 * or `null` when there is no conflict. Term logic mirrors the generator: an F
 * course and an S course never conflict, while a Y course is compared in both
 * terms.
 */
export function sectionConflictsWithPlan(
  candidate: Section,
  sectionCode: SectionCode,
  courseKeyToSkip: string,
  selected: readonly PlanSelectedSection[],
): PlanSelectedSection | null {
  for (const other of selected) {
    if (other.courseKey === courseKeyToSkip) {
      continue;
    }

    for (const term of ["fall", "winter"] as const) {
      if (
        !courseAppliesToTerm(sectionCode, term) ||
        !courseAppliesToTerm(other.sectionCode, term)
      ) {
        continue;
      }

      const candidateMeetings = activeMeetingsForTerm(candidate, term);
      const otherMeetings = activeMeetingsForTerm(other.section, term);

      const overlaps = candidateMeetings.some((left) =>
        otherMeetings.some((right) => meetingTimesOverlap(left, right)),
      );

      if (overlaps) {
        return other;
      }
    }
  }

  return null;
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

/**
 * Projects the richer `SelectedTimetableSection` shape (used by the timetable
 * rendering pipeline) down to the `PlanSelectedSection` fields the linkage and
 * conflict helpers need.
 */
export function planSelectedFromTimetableSections(
  selectedSections: readonly SelectedTimetableSection[],
): PlanSelectedSection[] {
  return selectedSections.map((selectedSection) => ({
    courseKey: selectedSection.courseKey,
    courseCode: selectedSection.course.code,
    sectionCode: selectedSection.course.sectionCode,
    teachMethod: selectedSection.teachMethod,
    section: selectedSection.section,
  }));
}

/**
 * Returns the composite keys of selected sections that violate UofT section
 * linkage (e.g. a tutorial that must be taken with a different lecture than the
 * one currently chosen). Sections are grouped by `courseKey`, and each is
 * checked against the other selected sections of the SAME course that belong to
 * a DIFFERENT teach method via `sectionAllowedByLinkage`.
 *
 * Keys use the same composite format as conflict keys (`selectedSectionKey`) so
 * callers can pass the result straight into `buildTermBlocks`.
 */
export function detectLinkageViolationSectionKeys(
  selected: readonly PlanSelectedSection[],
): Set<string> {
  const byCourse = new Map<string, PlanSelectedSection[]>();

  for (const entry of selected) {
    const group = byCourse.get(entry.courseKey);

    if (group) {
      group.push(entry);
    } else {
      byCourse.set(entry.courseKey, [entry]);
    }
  }

  const keys = new Set<string>();

  for (const group of byCourse.values()) {
    for (const entry of group) {
      const selectedOthers = group
        .filter((other) => other.teachMethod !== entry.teachMethod)
        .map((other) => other.section);

      if (!sectionAllowedByLinkage(entry.section, selectedOthers)) {
        keys.add(
          selectedSectionKey(
            { courseCode: entry.courseCode, sectionCode: entry.sectionCode },
            entry.teachMethod,
            entry.section.name,
          ),
        );
      }
    }
  }

  return keys;
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
