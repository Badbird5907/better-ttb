import type { Course } from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import { csc108Course } from "@/server/__fixtures__/ttb-pageable-csc108";
import type { Plan } from "@/stores/plan";
import {
  catalogSessionsMatchPlan,
  collectPinnedCourses,
  COURSE_AUTO_REFRESH_AFTER_MS,
  isCourseAutoRefreshDue,
  type AutoRefreshTiming,
} from "./use-catalog";

describe("pinned course auto refresh", () => {
  it("collects only unique offerings pinned in the active plan", () => {
    const csc108 = structuredClone(csc108Course) as Course;
    const mat224 = structuredClone(csc108) as Course;
    mat224.id = "mat224-id";
    mat224.code = "MAT224H1";
    const plan = {
      pinned: [
        { courseCode: csc108.code, sectionCode: csc108.sectionCode, chosen: {} },
        { courseCode: csc108.code, sectionCode: csc108.sectionCode, chosen: {} },
        { courseCode: "MISSINGH1", sectionCode: "F", chosen: {} },
      ],
    } as Pick<Plan, "pinned">;

    expect(collectPinnedCourses([csc108, mat224], plan)).toEqual([csc108]);
  });

  it("matches only the catalog loaded for the active plan sessions", () => {
    expect(catalogSessionsMatchPlan("20269,20271", ["20269", "20271"])).toBe(
      true,
    );
    expect(catalogSessionsMatchPlan("20269", ["20271"])).toBe(false);
    expect(catalogSessionsMatchPlan(null, ["20269"])).toBe(false);
  });

  it("is due initially and at the exact 30-minute boundary", () => {
    const now = Date.parse("2026-07-10T13:00:00.000Z");
    const key = "20269:course-id";

    expect(isCourseAutoRefreshDue(key, now, new Map())).toBe(true);

    const stillFresh = new Map<string, AutoRefreshTiming>([
      [
        key,
        {
          refreshedAt: now - COURSE_AUTO_REFRESH_AFTER_MS + 1,
          nextAttemptAt: 0,
        },
      ],
    ]);
    expect(isCourseAutoRefreshDue(key, now, stillFresh)).toBe(false);

    const due = new Map<string, AutoRefreshTiming>([
      [
        key,
        {
          refreshedAt: now - COURSE_AUTO_REFRESH_AFTER_MS,
          nextAttemptAt: 0,
        },
      ],
    ]);
    expect(isCourseAutoRefreshDue(key, now, due)).toBe(true);
  });

  it("defers a due course until its retry time", () => {
    const now = Date.parse("2026-07-10T13:00:00.000Z");
    const key = "20269:course-id";
    const timings = new Map<string, AutoRefreshTiming>([
      [key, { refreshedAt: null, nextAttemptAt: now + 45_000 }],
    ]);

    expect(isCourseAutoRefreshDue(key, now, timings)).toBe(false);
    expect(isCourseAutoRefreshDue(key, now + 45_000, timings)).toBe(true);
  });
});
