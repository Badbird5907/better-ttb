import type {
  DayNumber,
  DeliveryMode,
  MeetingTime,
  Section,
  SectionCode,
} from "@better-ttb/shared";

import type { Coordinates, Term } from "./types";

export const MINUTE = 60_000;
export const DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const;

const EARTH_RADIUS_METERS = 6_371_000;
const CAMPUS_ROUTE_MULTIPLIER = 1.3;
const WALKING_METERS_PER_SECOND = 1.4;

export function walkMinutes(a: Coordinates, b: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLng = toRadians(b.lng - a.lng);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  const meters = EARTH_RADIUS_METERS * centralAngle;

  return (meters * CAMPUS_ROUTE_MULTIPLIER) / WALKING_METERS_PER_SECOND / 60;
}

export function termsForSectionCode(sectionCode: SectionCode): Term[] {
  if (sectionCode === "F") {
    return ["fall"];
  }

  if (sectionCode === "S") {
    return ["winter"];
  }

  return ["fall", "winter"];
}

export function isCancelled(section: Section): boolean {
  return section.cancelInd === "Y";
}

export function isAsyncSection(section: Section): boolean {
  return section.tbaInd === "Y" || section.meetingTimes.length === 0;
}

export function activeMeetings(section: Section): MeetingTime[] {
  if (isAsyncSection(section)) {
    return [];
  }

  return section.meetingTimes.filter(
    (meeting) => meeting.end.millisofday > meeting.start.millisofday,
  );
}

export function millisToMinutes(millis: number): number {
  return millis / MINUTE;
}

export function minutesToMillis(minutes: number): number {
  return minutes * MINUTE;
}

export function meetingStartMinutes(meeting: MeetingTime): number {
  return millisToMinutes(meeting.start.millisofday);
}

export function meetingEndMinutes(meeting: MeetingTime): number {
  return millisToMinutes(meeting.end.millisofday);
}

export function intervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && startB < endA;
}

export function overlapMillis(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): number {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return Math.max(0, end - start);
}

export function repetitionsCanConflict(a: MeetingTime, b: MeetingTime): boolean {
  const first = a.repetitionTime;
  const second = b.repetitionTime;

  return !(
    (first === "FIRST_AND_THIRD_WEEK" && second === "SECOND_AND_FOURTH_WEEK") ||
    (first === "SECOND_AND_FOURTH_WEEK" && second === "FIRST_AND_THIRD_WEEK")
  );
}

export function isFullSection(section: Section): boolean {
  return section.currentEnrolment >= section.maxEnrolment;
}

export function sectionDeliveryModes(section: Section): DeliveryMode[] {
  const modes = new Set(section.deliveryModes.map((deliveryMode) => deliveryMode.mode));

  if (isAsyncSection(section)) {
    modes.add("ASYNC");
  }

  return [...modes];
}

export function sectionInstructorText(section: Section): string {
  return section.instructors
    .map((instructor) => `${instructor.firstName} ${instructor.lastName}`)
    .join(" ")
    .toLowerCase();
}

export function makeDayRecord<T>(value: T): Record<DayNumber, T> {
  return {
    1: value,
    2: value,
    3: value,
    4: value,
    5: value,
    6: value,
    7: value,
  };
}

export function sortDays(days: Iterable<DayNumber>): DayNumber[] {
  return [...days].sort((a, b) => a - b);
}

export function formatClock(millis: number): string {
  const totalMinutes = Math.round(millisToMinutes(millis));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}`;
}

export function roundMinutes(minutes: number): number {
  return Number(minutes.toFixed(1));
}
