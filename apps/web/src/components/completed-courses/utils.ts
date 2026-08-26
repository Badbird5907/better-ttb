import * as React from "react";

import { useCatalogStore } from "@/stores/catalog";

/**
 * Unanchored twin of the store's course-code regex, used to scrape codes out of
 * pasted transcript text (uppercase the haystack before matching).
 */
const COURSE_CODE_IN_TEXT = /[A-Z]{3,4}\d{2,3}[HY]\d/g;
const SUBJECT_PREFIX = /^[A-Z]{3,4}/;

const HALF_CREDIT = 0.5;
const FULL_CREDIT = 1;

/** U of T encodes credit weight in the code suffix: H = 0.5 FCE, Y = 1.0 FCE. */
export function creditWeightForCode(code: string): number {
  return /Y\d$/.test(code) ? FULL_CREDIT : HALF_CREDIT;
}

export function totalCredits(codes: readonly string[]): number {
  return codes.reduce((sum, code) => sum + creditWeightForCode(code), 0);
}

/**
 * Converts the completed-courses store's `code -> grade %` map into the
 * `code -> credit weight override` map `evaluateProgram` expects.
 *
 * The two maps are structurally identical (`Record<string, number | null>`)
 * but mean different things, so passing the store's map straight through makes
 * a course graded 78 count as 78 credits. Every U of T course's weight is
 * implied by its code, so there is never an override to pass: null throughout.
 */
export function creditWeightsFromCompleted(
  courses: Readonly<Record<string, number | null>>,
): Record<string, number | null> {
  const weights: Record<string, number | null> = {};

  for (const code of Object.keys(courses)) {
    weights[code] = null;
  }

  return weights;
}

export function formatCredits(credits: number): string {
  return credits.toFixed(1);
}

export function subjectPrefix(code: string): string {
  return code.match(SUBJECT_PREFIX)?.[0] ?? code;
}

/** Extracts unique course codes (in first-seen order) from arbitrary text. */
export function extractCourseCodes(text: string): string[] {
  const matches = text.toUpperCase().match(COURSE_CODE_IN_TEXT) ?? [];
  const seen = new Set<string>();
  const codes: string[] = [];

  matches.forEach((match) => {
    if (seen.has(match)) {
      return;
    }

    seen.add(match);
    codes.push(match);
  });

  return codes;
}

/**
 * Course code -> name from the loaded catalog. The catalog holds one entry per
 * offering (F/S/Y), so the first name seen for a code wins. Returns an empty
 * map when the catalog hasn't loaded, which every consumer treats as "no name".
 */
export function useCourseNamesByCode(): ReadonlyMap<string, string> {
  const catalog = useCatalogStore((state) => state.catalog);

  return React.useMemo(() => {
    const namesByCode = new Map<string, string>();

    catalog?.courses.forEach((course) => {
      if (!namesByCode.has(course.code)) {
        namesByCode.set(course.code, course.name);
      }
    });

    return namesByCode;
  }, [catalog]);
}
