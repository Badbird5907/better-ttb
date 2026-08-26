import { compareMeetingTimes } from "./time";
import type { MeetingTime, Section } from "./ttb-api";

export function isSectionFull(section: Section): boolean {
  return (
    section.maxEnrolment > 0 &&
    section.currentEnrolment >= section.maxEnrolment
  );
}

/**
 * Whether enrolling in `section` right now would place you on a waitlist.
 *
 * `waitlistInd === "Y"` only means the section *supports* a waitlist — many
 * sections with open seats carry it. A waitlist is actually active only once the
 * section is full, i.e. `currentEnrolment` (the number enrolled, not seats
 * remaining) has reached `maxEnrolment`.
 */
export function isSectionWaitlisted(section: Section): boolean {
  return (
    section.waitlistInd === "Y" &&
    isSectionFull(section)
  );
}

/** A section's meeting times in the order they run through the week. */
export function sortedMeetingTimes(section: Section): MeetingTime[] {
  return [...section.meetingTimes].sort(compareMeetingTimes);
}

/**
 * Orders sections by when they first meet, so a list reads chronologically
 * rather than in whatever order TTB returned. Sections with no meeting times
 * (TBA, async) sort last; ties fall back to the section name.
 */
export function compareSectionsByTime(left: Section, right: Section): number {
  const leftFirst = earliestMeetingTime(left);
  const rightFirst = earliestMeetingTime(right);

  if (!leftFirst || !rightFirst) {
    return (
      Number(Boolean(rightFirst)) - Number(Boolean(leftFirst)) ||
      left.name.localeCompare(right.name)
    );
  }

  return (
    compareMeetingTimes(leftFirst, rightFirst) ||
    left.name.localeCompare(right.name)
  );
}

export function sortSectionsByTime(sections: readonly Section[]): Section[] {
  return [...sections].sort(compareSectionsByTime);
}

function earliestMeetingTime(section: Section): MeetingTime | undefined {
  return section.meetingTimes.reduce<MeetingTime | undefined>(
    (earliest, meeting) =>
      !earliest || compareMeetingTimes(meeting, earliest) < 0 ? meeting : earliest,
    undefined,
  );
}
