import type {
  Course,
  DayNumber,
  DeliveryMode,
  SectionCode,
} from "@better-ttb/shared";
import MiniSearch from "minisearch";

import { stripHtml } from "@/lib/sanitize";

export interface CourseSearchDocument {
  id: string;
  code: string;
  name: string;
  description: string;
}

export interface CourseSearchIndex {
  courses: Course[];
  documents: CourseSearchDocument[];
  byId: Map<string, Course>;
  index: MiniSearch<CourseSearchDocument>;
}

export interface CourseSearchFilters {
  departments: string[];
  levels: string[];
  sectionCodes: SectionCode[];
  deliveryModes: DeliveryMode[];
  creditWeights: number[];
  breadthCodes: string[];
  instructor: string;
  days: DayNumber[];
  availableSpace: boolean;
  waitlistable: boolean;
}

export const DEFAULT_SEARCH_FILTERS: CourseSearchFilters = {
  departments: [],
  levels: [],
  sectionCodes: [],
  deliveryModes: [],
  creditWeights: [],
  breadthCodes: [],
  instructor: "",
  days: [],
  availableSpace: false,
  waitlistable: false,
};

export const DAY_FILTERS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
] as const satisfies ReadonlyArray<{ value: DayNumber; label: string }>;

export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  ASYNC: "Async",
  HYBR: "Hybrid",
  INPER: "In person",
  SYNC: "Sync online",
};

export function createCourseSearch(courses: Course[]): CourseSearchIndex {
  const documents = courses.map((course) => ({
    id: courseSearchId(course),
    code: course.code,
    name: course.name,
    description: stripHtml(course.cmCourseInfo?.description ?? null),
  }));
  const byId = new Map<string, Course>();

  courses.forEach((course) => {
    byId.set(courseSearchId(course), course);
  });

  const index = new MiniSearch<CourseSearchDocument>({
    fields: ["code", "name", "description"],
    idField: "id",
    storeFields: ["code", "name"],
    searchOptions: {
      boost: { code: 4, name: 2, description: 1 },
      fuzzy: 0.2,
      prefix: true,
    },
  });

  index.addAll(documents);

  return {
    courses,
    documents,
    byId,
    index,
  };
}

export function searchCourses(
  searchIndex: CourseSearchIndex,
  query: string,
  filters: CourseSearchFilters,
): Course[] {
  const trimmedQuery = query.trim();
  const candidates =
    trimmedQuery.length === 0
      ? searchIndex.courses
      : searchIndex.index
          .search(trimmedQuery, {
            boost: { code: 4, name: 2, description: 1 },
            fuzzy: 0.2,
            prefix: true,
          })
          .map((result) => searchIndex.byId.get(String(result.id)))
          .filter((course): course is Course => course !== undefined);

  return filterCourses(candidates, filters);
}

export function filterCourses(
  courses: readonly Course[],
  filters: CourseSearchFilters,
): Course[] {
  return courses.filter((course) => courseMatchesFilters(course, filters));
}

export function courseMatchesFilters(
  course: Course,
  filters: CourseSearchFilters,
): boolean {
  return (
    matchesDepartment(course, filters.departments) &&
    matchesLevel(course, filters.levels) &&
    matchesSectionCode(course, filters.sectionCodes) &&
    matchesDeliveryMode(course, filters.deliveryModes) &&
    matchesCreditWeight(course, filters.creditWeights) &&
    matchesBreadth(course, filters.breadthCodes) &&
    matchesInstructor(course, filters.instructor) &&
    matchesDays(course, filters.days) &&
    (!filters.availableSpace || hasAvailableSpace(course)) &&
    (!filters.waitlistable || isWaitlistable(course))
  );
}

export function hasActiveFilters(filters: CourseSearchFilters): boolean {
  return (
    filters.departments.length > 0 ||
    filters.levels.length > 0 ||
    filters.sectionCodes.length > 0 ||
    filters.deliveryModes.length > 0 ||
    filters.creditWeights.length > 0 ||
    filters.breadthCodes.length > 0 ||
    filters.instructor.trim().length > 0 ||
    filters.days.length > 0 ||
    filters.availableSpace ||
    filters.waitlistable
  );
}

export function courseSearchId(course: Course): string {
  return course.id || `${course.code}:${course.sectionCode}`;
}

export function getCourseLevel(course: Course): string | null {
  const digit = course.code.at(3);

  if (!digit || !/[1-4]/.test(digit)) {
    return null;
  }

  return `${digit}00`;
}

export function getCourseBreadthCodes(course: Course): string[] {
  const codes = new Set<string>();

  course.breadths.forEach((breadth) => collectBreadthCodes(breadth, codes));
  (course.cmCourseInfo?.breadthRequirements ?? []).forEach((breadth) => {
    const match = breadth.match(/\bBR\s*=?\s*([1-5])\b/i);

    if (match?.[1]) {
      codes.add(`BR=${match[1]}`);
    }
  });

  return [...codes].sort(compareBreadthCodes);
}

export function getCourseDeliveryModes(course: Course): DeliveryMode[] {
  const modes = new Set<DeliveryMode>();

  course.sections.forEach((section) => {
    section.deliveryModes.forEach((deliveryMode) => modes.add(deliveryMode.mode));

    if (section.tbaInd === "Y" || section.meetingTimes.length === 0) {
      modes.add("ASYNC");
    }
  });

  return [...modes].sort();
}

export function hasAvailableSpace(course: Course): boolean {
  return course.sections.some(
    (section) => section.currentEnrolment < section.maxEnrolment,
  );
}

export function isWaitlistable(course: Course): boolean {
  return (
    course.primaryWaitlistable ||
    course.sections.some((section) => section.waitlistInd === "Y")
  );
}

function matchesDepartment(course: Course, departments: readonly string[]): boolean {
  if (departments.length === 0) {
    return true;
  }

  return departments.some((department) => {
    const normalized = department.toLowerCase();

    return (
      course.department.code.toLowerCase() === normalized ||
      course.department.name.toLowerCase() === normalized
    );
  });
}

function matchesLevel(course: Course, levels: readonly string[]): boolean {
  return levels.length === 0 || levels.includes(getCourseLevel(course) ?? "");
}

function matchesSectionCode(
  course: Course,
  sectionCodes: readonly SectionCode[],
): boolean {
  return sectionCodes.length === 0 || sectionCodes.includes(course.sectionCode);
}

function matchesDeliveryMode(
  course: Course,
  deliveryModes: readonly DeliveryMode[],
): boolean {
  if (deliveryModes.length === 0) {
    return true;
  }

  const courseModes = getCourseDeliveryModes(course);
  return deliveryModes.some((mode) => courseModes.includes(mode));
}

function matchesCreditWeight(course: Course, creditWeights: readonly number[]): boolean {
  return creditWeights.length === 0 || creditWeights.includes(course.maxCredit);
}

function matchesBreadth(course: Course, breadthCodes: readonly string[]): boolean {
  if (breadthCodes.length === 0) {
    return true;
  }

  const courseBreadths = getCourseBreadthCodes(course);
  return breadthCodes.some((breadth) => courseBreadths.includes(breadth));
}

function matchesInstructor(course: Course, instructor: string): boolean {
  const normalized = instructor.trim().toLowerCase();

  if (normalized.length === 0) {
    return true;
  }

  return course.sections.some((section) =>
    section.instructors.some((entry) =>
      `${entry.firstName} ${entry.lastName}`.toLowerCase().includes(normalized),
    ),
  );
}

function matchesDays(course: Course, days: readonly DayNumber[]): boolean {
  if (days.length === 0) {
    return true;
  }

  return course.sections.some((section) =>
    section.meetingTimes.some((meeting) => days.includes(meeting.start.day)),
  );
}

function collectBreadthCodes(value: unknown, codes: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectBreadthCodes(entry, codes));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (typeof value.code === "string" && /^BR=[1-5]$/i.test(value.code)) {
    codes.add(value.code.toUpperCase());
  }

  Object.values(value).forEach((entry) => collectBreadthCodes(entry, codes));
}

function compareBreadthCodes(left: string, right: string): number {
  return breadthRank(left) - breadthRank(right);
}

function breadthRank(value: string): number {
  const match = value.match(/([1-5])$/);
  return match?.[1] ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
