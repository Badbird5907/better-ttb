import type { Course, Section } from "@better-ttb/shared";
import { sectionAllowedByLinkage } from "@better-ttb/shared";

/**
 * Whether a section can be selected, and — when it cannot — a human-readable
 * reason. `hint` carries non-blocking information (e.g. TBA) that should be
 * surfaced even when the section is selectable.
 *
 * Reason strings are copied verbatim from TTB's own frontend so the wording
 * matches what students see on the official site.
 */
export interface SectionAvailability {
  disabled: boolean;
  reason?: string;
  hint?: string;
}

const CANCELLED_REASON =
  "Activity cancelled: This activity is not available for selection because it has been cancelled.";
const UNAVAILABLE_REASON =
  "Activity unavailable: This activity is currently unavailable. Please check back again later.";
const LINKAGE_REASON =
  "Activity unavailable: This activity is not available for selection because it must be taken together with a different activity.";
const TBA_HINT = "This section doesn't have a day and time specified yet.";

/**
 * Computes whether `section` is selectable given the sections already chosen
 * for the OTHER teach methods of the same course (`selectedOthers`).
 *
 * Priority order (first match wins for `reason`):
 *   1. cancelInd === "Y"      → cancelled
 *   2. openLimitInd === "C"   → unavailable
 *   3. linkage violation      → must be taken together
 * A `tbaInd === "Y"` section is never disabled, but carries a TBA `hint`.
 */
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

export function getSectionAvailability(
  section: Section,
  selectedOthers: Section[],
): SectionAvailability {
  const hint = section.tbaInd === "Y" ? TBA_HINT : undefined;

  if (section.cancelInd === "Y") {
    return { disabled: true, reason: CANCELLED_REASON, ...(hint ? { hint } : {}) };
  }

  if (section.openLimitInd === "C") {
    return { disabled: true, reason: UNAVAILABLE_REASON, ...(hint ? { hint } : {}) };
  }

  if (!sectionAllowedByLinkage(section, selectedOthers)) {
    return { disabled: true, reason: LINKAGE_REASON, ...(hint ? { hint } : {}) };
  }

  return { disabled: false, ...(hint ? { hint } : {}) };
}

/**
 * Resolves the chosen section names of teach methods OTHER than `teachMethod`
 * into `Section` objects from `course.sections`.
 *
 * `chosen` maps teach method → chosen section name (or null/"" for none).
 * Entries for `teachMethod` itself, empty choices, and names that don't
 * resolve to a section are skipped.
 */
export function selectedOthersFor(
  course: Course,
  chosen: Record<string, string | null>,
  teachMethod: string,
): Section[] {
  const others: Section[] = [];

  for (const [method, sectionName] of Object.entries(chosen)) {
    if (method === teachMethod || !sectionName) {
      continue;
    }

    const section = course.sections.find(
      (candidate) => candidate.teachMethod === method && candidate.name === sectionName,
    );

    if (section) {
      others.push(section);
    }
  }

  return others;
}
