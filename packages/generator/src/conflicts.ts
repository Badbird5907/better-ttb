import type { MeetingTime, Section } from "@better-ttb/shared";

import type { TimetableConflict } from "./types";
import {
  activeMeetings,
  intervalsOverlap,
  overlapMillis,
  repetitionsCanConflict,
} from "./time";

export function detectConflicts(sections: readonly Section[]): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];

  for (let firstIndex = 0; firstIndex < sections.length; firstIndex += 1) {
    const first = sections[firstIndex];
    if (!first) {
      continue;
    }

    for (let secondIndex = firstIndex + 1; secondIndex < sections.length; secondIndex += 1) {
      const second = sections[secondIndex];
      if (!second) {
        continue;
      }

      conflicts.push(...conflictsBetweenSections(first, second));
    }
  }

  return conflicts;
}

export function conflictsBetweenSections(
  first: Section,
  second: Section,
): TimetableConflict[] {
  const conflicts: TimetableConflict[] = [];

  for (const firstMeeting of activeMeetings(first)) {
    for (const secondMeeting of activeMeetings(second)) {
      const overlap = meetingConflictOverlap(firstMeeting, secondMeeting);
      if (overlap === null) {
        continue;
      }

      conflicts.push({
        day: firstMeeting.start.day,
        first: first.name,
        second: second.name,
        startMillis: overlap.startMillis,
        endMillis: overlap.endMillis,
      });
    }
  }

  return conflicts;
}

export function meetingsConflict(first: MeetingTime, second: MeetingTime): boolean {
  return meetingConflictOverlap(first, second) !== null;
}

function meetingConflictOverlap(
  first: MeetingTime,
  second: MeetingTime,
): { startMillis: number; endMillis: number } | null {
  if (first.start.day !== second.start.day) {
    return null;
  }

  if (!repetitionsCanConflict(first, second)) {
    return null;
  }

  if (
    !intervalsOverlap(
      first.start.millisofday,
      first.end.millisofday,
      second.start.millisofday,
      second.end.millisofday,
    )
  ) {
    return null;
  }

  const duration = overlapMillis(
    first.start.millisofday,
    first.end.millisofday,
    second.start.millisofday,
    second.end.millisofday,
  );

  if (duration <= 0) {
    return null;
  }

  return {
    startMillis: Math.max(first.start.millisofday, second.start.millisofday),
    endMillis: Math.min(first.end.millisofday, second.end.millisofday),
  };
}

