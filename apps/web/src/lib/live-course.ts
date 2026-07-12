import type { Course, SectionCode, TtbCourseLookupResponse } from "@better-ttb/shared";

export function extractLiveCourse(
  response: TtbCourseLookupResponse,
  sectionCode: SectionCode,
): Course | null {
  const payload = response.payload;

  if (!payload) {
    return null;
  }

  const candidates = Array.isArray(payload)
    ? payload
    : isCourse(payload)
      ? [payload]
      : extractCoursesFromRecord(payload as Record<string, unknown>);

  return (
    candidates.find((course) => course.sectionCode === sectionCode) ??
    candidates[0] ??
    null
  );
}

function extractCoursesFromRecord(value: Record<string, unknown>): Course[] {
  // pageableCourse.courses — shape returned by getCoursesByCodeAndSectionCode
  const pageableCourse = value.pageableCourse;
  if (isRecord(pageableCourse) && Array.isArray(pageableCourse.courses)) {
    return pageableCourse.courses.filter(isCourse);
  }

  // Legacy / fallback shapes
  const course = value.course;
  const courses = value.courses;

  if (isCourse(course)) {
    return [course];
  }

  if (Array.isArray(courses)) {
    return courses.filter(isCourse);
  }

  return [];
}

export function mergeLiveEnrolment(base: Course, live: Course): Course {
  const liveSections = new Map(
    live.sections.map((section) => [section.name, section]),
  );

  return {
    ...base,
    primaryFull: live.primaryFull,
    primaryWaitlistable: live.primaryWaitlistable,
    sections: base.sections.map((section) => {
      const liveSection = liveSections.get(section.name);

      if (!liveSection) {
        return section;
      }

      return {
        ...section,
        currentEnrolment: liveSection.currentEnrolment,
        maxEnrolment: liveSection.maxEnrolment,
        currentWaitlist: liveSection.currentWaitlist,
        waitlistInd: liveSection.waitlistInd,
        cancelInd: liveSection.cancelInd,
        enrolmentInd: liveSection.enrolmentInd,
        openLimitInd: liveSection.openLimitInd,
      };
    }),
  };
}

function isCourse(value: unknown): value is Course {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.sectionCode === "string" &&
    Array.isArray(value.sections)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
