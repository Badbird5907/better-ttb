import type { SectionCode } from "@better-ttb/shared";

import { createDefaultPlanPrefs, type PinnedCourse, type Plan } from "@/stores/plan";

export function parsePlanImport(value: unknown): Plan | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.name !== "string" ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.pinned)
  ) {
    return null;
  }

  const sessions = value.sessions.filter((session): session is string => typeof session === "string");
  const pinned = value.pinned
    .map(parsePinnedCourse)
    .filter((entry): entry is PinnedCourse => Boolean(entry));

  if (sessions.length === 0) {
    return null;
  }

  return {
    id: typeof value.id === "string" ? value.id : "imported",
    name: value.name,
    sessions,
    pinned,
    prefs: isRecord(value.prefs) ? value.prefs : createDefaultPlanPrefs(),
  };
}

export function parsePlanJson(text: string): Plan | null {
  try {
    return parsePlanImport(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function parsePinnedCourse(value: unknown): PinnedCourse | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.courseCode !== "string" ||
    !isSectionCode(value.sectionCode) ||
    !isRecord(value.chosen)
  ) {
    return null;
  }

  const chosen: PinnedCourse["chosen"] = {};

  Object.entries(value.chosen).forEach(([teachMethod, sectionName]) => {
    if (typeof sectionName === "string" || sectionName === null) {
      chosen[teachMethod] = sectionName;
    }
  });

  return {
    courseCode: value.courseCode,
    sectionCode: value.sectionCode,
    chosen,
  };
}

function isSectionCode(value: unknown): value is SectionCode {
  return value === "F" || value === "S" || value === "Y";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
