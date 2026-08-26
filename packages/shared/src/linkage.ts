import type { LinkedMeetingSection, Section } from "./ttb-api";

type SectionLike = Pick<Section, "name" | "teachMethod" | "linkedMeetingSections">;

/**
 * Returns the resolved name for a linked meeting section reference,
 * e.g. { teachMethod: "LEC", sectionNumber: "0101" } → "LEC0101".
 */
export function linkedSectionName(ref: LinkedMeetingSection): string {
  return ref.teachMethod + ref.sectionNumber;
}

/**
 * Determines whether `candidate` is permitted given the currently-selected
 * sections for OTHER teach methods (`selectedOthers`).
 *
 * Faithfully implements TTB's `processLinkedMeetingSections` logic.
 * Any entries in `selectedOthers` that share the candidate's teach method
 * are silently ignored so callers can be sloppy.
 */
export function sectionAllowedByLinkage(
  candidate: SectionLike,
  selectedOthers: Array<SectionLike>,
): boolean {
  // Defensively filter out same-teach-method entries.
  const others = selectedOthers.filter(
    (o) => o.teachMethod !== candidate.teachMethod,
  );

  // s = names of the other selected sections.
  const s = new Set(others.map((o) => o.name));

  // o = union of all linked-section names pointed to by the other selections.
  const o = new Set<string>();
  for (const other of others) {
    if (other.linkedMeetingSections != null) {
      for (const ref of other.linkedMeetingSections) {
        o.add(linkedSectionName(ref));
      }
    }
  }

  // If nothing else is selected, everything is permitted.
  if (s.size === 0) return true;

  const links = candidate.linkedMeetingSections;

  // null/undefined → no linkage constraints → always permitted.
  if (links == null) return true;

  if (links.length > 0) {
    // Candidate links to specific sections: allowed if it points to something
    // already selected, OR if something already selected points back to it.
    const candidatePointsToSelected = links.some((ref) =>
      s.has(linkedSectionName(ref)),
    );
    const selectedPointsToCandidate = o.has(candidate.name);
    return candidatePointsToSelected || selectedPointsToCandidate;
  }

  // Empty array: the candidate declares no linkage of its own, so nothing about
  // it is inherently restricted. It is ruled out only by a selected section that
  // *does* declare links into the candidate's teach method and leaves it out —
  // picking TUT0201 (→ LEC0101) is what rules out every other lecture.
  //
  // Reading "[]" as "allowed only when something points at me" instead strands
  // sections like CSC207H1 TUT0501, where the tutorial and all five lectures
  // carry "[]", so nothing points anywhere and no lecture is ever selectable.
  return others.every((other) => {
    const constraints = (other.linkedMeetingSections ?? []).filter(
      (ref) => ref.teachMethod === candidate.teachMethod,
    );

    return (
      constraints.length === 0 ||
      constraints.some((ref) => linkedSectionName(ref) === candidate.name)
    );
  });
}

/**
 * Returns true iff every section in a full combination is mutually allowed.
 * For each section, checks `sectionAllowedByLinkage` against all the others.
 */
export function selectionSatisfiesLinkage(sections: Array<SectionLike>): boolean {
  return sections.every((section) =>
    sectionAllowedByLinkage(
      section,
      sections.filter((other) => other.teachMethod !== section.teachMethod),
    ),
  );
}
