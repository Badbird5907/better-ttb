import type { Section } from "./ttb-api";

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
    section.maxEnrolment > 0 &&
    section.currentEnrolment >= section.maxEnrolment
  );
}
