import type { Course, TtbCourseLookupResponse } from "@better-ttb/shared";
import { describe, expect, it, vi } from "vitest";

import { csc108Course } from "./__fixtures__/ttb-pageable-csc108";
import {
  parseCourseRefreshRequest,
  readCatalogUpdates,
  refreshStoredCourse,
} from "./catalog-courses";

describe("durable course refresh", () => {
  it("persists the complete live course without changing scrape ownership", async () => {
    const original = structuredClone(csc108Course) as Course;
    const live = structuredClone(original) as Course;
    live.sections[0]!.currentEnrolment = 99;
    live.sections[0]!.meetingTimes[0]!.building.buildingRoomNumber = "NEW";
    live.cmCourseInfo!.prerequisitesText = "CSC999H1";
    const harness = createCourseDb(original);
    const response: TtbCourseLookupResponse = {
      payload: {
        pageableCourse: {
          courses: [live],
          total: 1,
          page: 1,
          pageSize: 20,
          direction: "asc",
        },
      },
      status: [],
    };

    const result = await refreshStoredCourse(
      { DB: harness.db },
      original.code,
      { id: original.id, sectionCode: original.sectionCode, sessions: ["20269"] },
      {
        now: () => new Date("2026-07-10T13:00:00.000Z"),
        getCourses: vi.fn(async () => response),
      },
    );

    expect(result?.status).toBe(200);
    if (result?.status === 200) {
      expect(result.body.course.sections[0]?.currentEnrolment).toBe(99);
      expect(
        result.body.course.sections[0]?.meetingTimes[0]?.building.buildingRoomNumber,
      ).toBe("NEW");
      expect(result.body.course.cmCourseInfo?.prerequisitesText).toBe("CSC999H1");
    }
    expect(harness.scrapeRunId).toBe(42);
    expect(harness.persistedCourse?.sections[0]?.currentEnrolment).toBe(99);
  });

  it("returns a recently persisted course without another upstream fetch", async () => {
    const course = structuredClone(csc108Course) as Course;
    const getCourses = vi.fn();
    const harness = createCourseDb(course, {
      liveRefreshedAt: "2026-07-10T12:59:30.000Z",
    });
    const result = await refreshStoredCourse(
      { DB: harness.db },
      course.code,
      { id: course.id, sectionCode: course.sectionCode, sessions: ["20269"] },
      { now: () => new Date("2026-07-10T13:00:00.000Z"), getCourses },
    );
    expect(result).toMatchObject({ status: 200, body: { cached: true } });
    expect(getCourses).not.toHaveBeenCalled();
  });

  it("returns 202 while another refresh claim is active", async () => {
    const course = structuredClone(csc108Course) as Course;
    const harness = createCourseDb(course, { claimAvailable: false });
    const result = await refreshStoredCourse(
      { DB: harness.db },
      course.code,
      { id: course.id, sectionCode: course.sectionCode, sessions: ["20269"] },
      { now: () => new Date("2026-07-10T13:00:00.000Z") },
    );
    expect(result).toEqual({
      status: 202,
      body: { status: "in_progress", retryAfterSeconds: 2 },
    });
  });

  it("keeps the persisted row id when the upstream offering id changes", async () => {
    const original = structuredClone(csc108Course) as Course;
    const live = structuredClone(original) as Course;
    live.id = "replacement-upstream-id";
    live.sections[0]!.currentEnrolment = 77;
    const harness = createCourseDb(original);

    const result = await refreshStoredCourse(
      { DB: harness.db },
      original.code,
      { id: original.id, sectionCode: original.sectionCode, sessions: ["20269"] },
      {
        now: () => new Date("2026-07-10T13:00:00.000Z"),
        getCourses: async () => ({
          payload: {
            pageableCourse: {
              courses: [live],
              total: 1,
              page: 1,
              pageSize: 20,
              direction: "asc",
            },
          },
          status: [],
        }),
      },
    );

    expect(result?.status).toBe(200);
    if (result?.status === 200) {
      expect(result.body.course.id).toBe(original.id);
    }
    expect(harness.persistedCourse?.id).toBe(original.id);
  });

  it("canonicalizes sessions and rejects blank section codes", () => {
    expect(
      parseCourseRefreshRequest({
        id: " course-id ",
        sectionCode: " F ",
        sessions: ["20271", "20269", "20271"],
      }),
    ).toEqual({
      id: "course-id",
      sectionCode: "F",
      sessions: ["20269", "20271"],
    });
    expect(
      parseCourseRefreshRequest({
        id: "course-id",
        sectionCode: "   ",
        sessions: ["20269"],
      }),
    ).toBeNull();
  });
});

describe("catalog deltas", () => {
  it("paginates at 500 rows and uses updated_at plus id as its cursor", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => {
      const course = structuredClone(csc108Course) as Course;
      course.id = `course-${String(index).padStart(3, "0")}`;
      return {
        id: course.id,
        data_json: JSON.stringify(course),
        updated_at: "2026-07-10T13:00:00.000Z",
      };
    });
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => d1Result(rows),
        }),
      }),
    } as unknown as D1Database;
    const result = await readCatalogUpdates(db, ["20269"], {
      updatedAt: "2026-07-10T12:00:00.000Z",
      id: "",
    });
    expect(result.courses).toHaveLength(500);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual({
      updatedAt: "2026-07-10T13:00:00.000Z",
      id: "course-499",
    });
  });
});

function createCourseDb(
  course: Course,
  options: { liveRefreshedAt?: string; claimAvailable?: boolean } = {},
): {
  db: D1Database;
  persistedCourse: Course | null;
  scrapeRunId: number;
} {
  const state = {
    persistedCourse: null as Course | null,
    scrapeRunId: 42,
  };
  const row = {
    id: course.id,
    code: course.code,
    section_code: course.sectionCode,
    session: "20269",
    data_json: JSON.stringify(course),
    updated_at: "2026-07-10T12:00:00.000Z",
    live_refreshed_at: options.liveRefreshedAt ?? null,
    live_refresh_claimed_at: options.claimAvailable === false
      ? "2026-07-10T12:59:30.000Z"
      : null,
  };
  const db = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              const normalized = query.replace(/\s+/g, " ").trim();
              if (normalized.startsWith("SELECT id, code")) return row;
              if (normalized.startsWith("UPDATE courses SET live_refresh_claimed_at")) {
                if (options.claimAvailable === false) return null;
                row.live_refresh_claimed_at = String(values[0]);
                return { id: course.id };
              }
              throw new Error(`Unsupported first query: ${normalized}`);
            },
            async run() {
              const normalized = query.replace(/\s+/g, " ").trim();
              if (normalized.startsWith("UPDATE courses SET code = ?")) {
                state.persistedCourse = JSON.parse(String(values[4])) as Course;
                row.data_json = String(values[4]);
                row.updated_at = String(values[5]);
                row.live_refreshed_at = String(values[6]);
                row.live_refresh_claimed_at = null;
                return d1Result();
              }
              if (normalized.startsWith("UPDATE courses SET live_refresh_claimed_at = NULL")) {
                row.live_refresh_claimed_at = null;
                return d1Result();
              }
              throw new Error(`Unsupported run query: ${normalized}`);
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return {
    db,
    get persistedCourse() {
      return state.persistedCourse;
    },
    scrapeRunId: state.scrapeRunId,
  };
}

function d1Result<T = unknown>(results: T[] = []): D1Result<T> {
  return {
    success: true,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: results.length,
      rows_written: 0,
      last_row_id: 0,
      changed_db: false,
      changes: 1,
    },
    results,
  };
}
