import type { Course, TtbCourseLookupResponse } from "@better-ttb/shared";

export function extractLiveCourse(
  response: TtbCourseLookupResponse,
  base: Pick<Course, "id" | "code" | "sectionCode" | "sessions">,
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

  const matchingOfferings = candidates.filter(
    (course) =>
      course.code === base.code && course.sectionCode === base.sectionCode,
  );
  const exactId = matchingOfferings.find((course) => course.id === base.id);

  if (exactId) {
    return exactId;
  }

  const exactSessions = matchingOfferings.filter((course) =>
    sameSessions(course.sessions, base.sessions),
  );

  if (exactSessions.length === 1) {
    return exactSessions[0] ?? null;
  }

  const overlappingSessions = matchingOfferings.filter((course) =>
    course.sessions.some((session) => base.sessions.includes(session)),
  );

  return overlappingSessions.length === 1 ? overlappingSessions[0] ?? null : null;
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

function sameSessions(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightSessions = new Set(right);
  return left.every((session) => rightSessions.has(session));
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
