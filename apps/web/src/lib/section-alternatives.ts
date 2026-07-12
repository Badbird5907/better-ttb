import {
  isSectionWaitlisted,
  sectionAllowedByLinkage,
  type Course,
  type DayNumber,
  type Section,
  type TeachMethod,
} from "@better-ttb/shared";

import { selectedOthersFor } from "@/lib/section-status";
import {
  activeMeetingsForTerm,
  colorForCourse,
  sectionConflictsWithPlan,
  selectedSectionKey,
  type PlanSelectedSection,
  type Term,
  type TimetableBlock,
} from "@/lib/timetable";
import { lookupWalkSeconds } from "@/lib/walk-matrix";

export interface SlotGroup {
  day: DayNumber;
  startMillis: number;
  endMillis: number;
  options: Section[];
}

export interface LinkageImpact {
  clears: TeachMethod[];
  autoPicks: Array<{ teachMethod: TeachMethod; sectionName: string }>;
}

export interface WalkFromPreviousBlock {
  fromCode: string;
  minutes: number;
}

const THIRTY_MINUTES = 30 * 60 * 1000;

export function listAlternativeSections(
  course: Course,
  teachMethod: TeachMethod,
  currentSectionName: string,
): Section[] {
  return course.sections.filter(
    (section) =>
      section.teachMethod === teachMethod &&
      section.name !== currentSectionName &&
      section.cancelInd !== "Y" &&
      section.openLimitInd !== "C",
  );
}

export function groupAlternativesBySlot(
  sections: readonly Section[],
  term: Term,
): SlotGroup[] {
  const groups = new Map<string, SlotGroup>();

  for (const section of sections) {
    for (const meeting of activeMeetingsForTerm(section, term)) {
      const key = [
        meeting.start.day,
        meeting.start.millisofday,
        meeting.end.millisofday,
      ].join(":");
      const group = groups.get(key);

      if (group) {
        if (!group.options.some((option) => option.name === section.name)) {
          group.options.push(section);
        }
      } else {
        groups.set(key, {
          day: meeting.start.day,
          startMillis: meeting.start.millisofday,
          endMillis: meeting.end.millisofday,
          options: [section],
        });
      }
    }
  }

  return [...groups.values()].sort(
    (left, right) =>
      left.day - right.day ||
      left.startMillis - right.startMillis ||
      left.endMillis - right.endMillis ||
      firstOptionName(left).localeCompare(firstOptionName(right)),
  );
}

export function linkageImpact(
  course: Course,
  chosen: Record<string, string | null>,
  teachMethod: TeachMethod,
  candidate: Section,
): LinkageImpact {
  const selectedOthers = selectedOthersFor(course, chosen, teachMethod);
  const clears: TeachMethod[] = [];
  const autoPicks: Array<{ teachMethod: TeachMethod; sectionName: string }> = [];

  for (const selectedOther of selectedOthers) {
    if (sectionsAllowedTogether(candidate, selectedOther)) {
      continue;
    }

    const affectedTeachMethod = selectedOther.teachMethod;
    clears.push(affectedTeachMethod);

    const allowedAlternatives = course.sections.filter(
      (section) =>
        section.teachMethod === affectedTeachMethod &&
        section.cancelInd !== "Y" &&
        section.openLimitInd !== "C" &&
        sectionsAllowedTogether(candidate, section),
    );

    if (allowedAlternatives.length === 1) {
      autoPicks.push({
        teachMethod: affectedTeachMethod,
        sectionName: allowedAlternatives[0]!.name,
      });
    }
  }

  return { clears, autoPicks };
}

export function walkFromPreviousBlock(
  enrolledDayBlocks: readonly TimetableBlock[],
  slot: Pick<SlotGroup, "day" | "startMillis">,
  targetBuildingCode: string,
): WalkFromPreviousBlock | null {
  const toCode = targetBuildingCode.trim();

  if (!toCode) {
    return null;
  }

  const previous = enrolledDayBlocks
    .filter((block) => {
      const gap = slot.startMillis - block.endMillis;
      return block.day === slot.day && gap >= 0 && gap <= THIRTY_MINUTES;
    })
    .sort(
      (left, right) =>
        right.endMillis - left.endMillis ||
        right.startMillis - left.startMillis ||
        left.id.localeCompare(right.id),
    )[0];

  const fromCode = previous?.buildingCode.trim();

  if (!fromCode) {
    return null;
  }

  const seconds = lookupWalkSeconds(fromCode, toCode);

  if (seconds === null) {
    return null;
  }

  return {
    fromCode,
    minutes: Math.ceil(seconds / 60),
  };
}

export function buildAlternativeDraftBlocks(
  course: Course,
  courseKey: string,
  teachMethod: TeachMethod,
  chosen: Record<string, string | null>,
  term: Term,
  planSelectedSections: readonly PlanSelectedSection[],
): TimetableBlock[] {
  const currentSectionName = chosen[teachMethod];

  if (!currentSectionName) {
    return [];
  }

  return groupAlternativesBySlot(
    listAlternativeSections(course, teachMethod, currentSectionName),
    term,
  ).map((group) => {
    const firstOption = group.options[0]!;
    const firstMeeting = activeMeetingsForTerm(firstOption, term).find(
      (meeting) =>
        meeting.start.day === group.day &&
        meeting.start.millisofday === group.startMillis &&
        meeting.end.millisofday === group.endMillis,
    );
    const draftOptions = group.options.map((option) => option.name);
    const invalidates = new Set<string>();

    for (const option of group.options) {
      const impact = linkageImpact(course, chosen, teachMethod, option);

      for (const clearTeachMethod of impact.clears) {
        const sectionName = chosen[clearTeachMethod];

        if (sectionName) {
          invalidates.add(
            selectedSectionKey(
              { courseCode: course.code, sectionCode: course.sectionCode },
              clearTeachMethod,
              sectionName,
            ),
          );
        }
      }
    }

    return {
      id: `draft:${courseKey}:${teachMethod}:${group.day}:${group.startMillis}`,
      sectionKey: `draft:${courseKey}:${teachMethod}:${group.day}:${group.startMillis}`,
      courseKey,
      courseCode: course.code,
      courseName: course.name,
      teachMethod,
      sectionName:
        group.options.length === 1 ? firstOption.name : `${group.options.length} options`,
      room: firstMeeting ? formatRoom(firstMeeting) : "TBA",
      buildingCode: firstMeeting?.building.buildingCode.trim() ?? "",
      day: group.day,
      startMillis: group.startMillis,
      endMillis: group.endMillis,
      color: colorForCourse(course.code),
      conflict: group.options.some((option) =>
        Boolean(
          sectionConflictsWithPlan(
            option,
            course.sectionCode,
            courseKey,
            planSelectedSections,
          ),
        ),
      ),
      disallowed: false,
      preview: false,
      waitlisted: group.options.every((option) => isSectionWaitlisted(option)),
      draft: true,
      draftOptions,
      draftInvalidatesSectionKeys: [...invalidates].sort(),
    };
  });
}

function sectionsAllowedTogether(left: Section, right: Section): boolean {
  return (
    sectionAllowedByLinkage(left, [right]) &&
    sectionAllowedByLinkage(right, [left])
  );
}

function firstOptionName(group: SlotGroup): string {
  return group.options[0]?.name ?? "";
}

function formatRoom(meeting: Section["meetingTimes"][number]): string {
  const code = meeting.building.buildingCode;
  const number = meeting.building.buildingRoomNumber;
  const suffix = meeting.building.buildingRoomSuffix;
  const room = `${number}${suffix}`.trim();

  if (!code && !room) {
    return "TBA";
  }

  return `${code}${room ? ` ${room}` : ""}`.trim();
}
