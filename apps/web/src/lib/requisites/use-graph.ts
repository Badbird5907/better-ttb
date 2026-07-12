import type { Course, SectionCode } from "@better-ttb/shared";
import * as React from "react";

import { buildRequisiteGraph, type RequisiteGraph } from "./graph";

let cachedCourses: readonly Course[] | null = null;
let cachedGraph: RequisiteGraph | null = null;

/**
 * Build (or reuse) the catalog-wide requisite graph. Cached module-wide by
 * catalog array reference so the ~3.7k-course parse happens once per catalog
 * load, shared across routes.
 */
export function getRequisiteGraph(courses: readonly Course[]): RequisiteGraph {
  if (cachedCourses !== courses || cachedGraph === null) {
    cachedGraph = buildRequisiteGraph(courses);
    cachedCourses = courses;
  }

  return cachedGraph;
}

export function useRequisiteGraph(
  courses: readonly Course[] | null | undefined,
): RequisiteGraph | null {
  return React.useMemo(
    () => (courses ? getRequisiteGraph(courses) : null),
    [courses],
  );
}

const SECTION_PREFERENCE: Record<SectionCode, number> = { F: 0, S: 1, Y: 2 };

/** Pick the preferred offering (F > S > Y) for a bare course code. */
export function preferredOffering(
  offerings: readonly Course[],
): Course | null {
  let best: Course | null = null;

  for (const offering of offerings) {
    if (
      best === null ||
      (SECTION_PREFERENCE[offering.sectionCode] ?? 3) <
        (SECTION_PREFERENCE[best.sectionCode] ?? 3)
    ) {
      best = offering;
    }
  }

  return best;
}
