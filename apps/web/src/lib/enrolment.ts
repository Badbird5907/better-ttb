import type { DivisionalEnrolmentIndicators, EnrolmentControl } from "@better-ttb/shared";

/**
 * Builds human-readable line items from a list of enrolment controls,
 * faithfully reproducing TTB's own frontend algorithm.
 *
 * Controls whose `post.code` is "EXCEPTIONS" are skipped entirely.
 * The returned list is de-duplicated (Set-order preserved).
 */
export function enrolmentControlLineItems(controls: EnrolmentControl[]): string[] {
  const lines: string[] = [];

  for (const control of controls) {
    // Skip EXCEPTIONS controls (TTB skips these)
    if (control.post?.code === "EXCEPTIONS") {
      continue;
    }

    // Step 1: base phrase
    let line = control.quantity ? "All students" : "No students";

    // Step 2: year of study
    if (control.yearOfStudy && control.yearOfStudy !== "*") {
      line += ` in year of study ${control.yearOfStudy}`;
    }
    line += " ";

    // Step 3: org units — "in the {name} "
    const orgUnits = [
      control.primaryOrg,
      control.associatedOrg,
      control.secondOrg,
      control.adminOrg,
      control.post,
      control.subjectPost,
    ];
    for (const unit of orgUnits) {
      if (
        unit?.code &&
        unit.code !== "*" &&
        unit.code.trim() !== "" &&
        unit.name.trim() !== ""
      ) {
        line += `in the ${unit.name} `;
      }
    }

    // Step 4: subject — "in {name} "
    if (
      control.subject?.code &&
      control.subject.code !== "*" &&
      control.subject.code.trim() !== "" &&
      control.subject.name.trim() !== ""
    ) {
      line += `in ${control.subject.name} `;
    }

    // Step 5: designation — "{name}s "
    if (
      control.designation?.code &&
      control.designation.code !== "*" &&
      control.designation.code.trim() !== "" &&
      control.designation.name.trim() !== ""
    ) {
      line += `${control.designation.name}s `;
    }

    lines.push(line.trim());
  }

  // Dedupe preserving order
  return [...new Set(lines)];
}

/**
 * Returns the description text for an enrolment indicator code within a
 * specific division, or null when not found / empty indicator.
 *
 * Comparison is done with `.trim()` on both sides (matching TTB's behaviour).
 */
export function enrolmentIndicatorDescription(
  indicators: DivisionalEnrolmentIndicators,
  divisionCode: string,
  enrolmentInd: string,
): string | null {
  if (!enrolmentInd) {
    return null;
  }

  const divisionIndicators = indicators[divisionCode];

  if (!divisionIndicators) {
    return null;
  }

  const trimmed = enrolmentInd.trim();
  const match = divisionIndicators.find((indicator) => indicator.code.trim() === trimmed);

  return match?.name ?? null;
}
