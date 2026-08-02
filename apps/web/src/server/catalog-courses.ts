import type {
  CatalogDeltaCursor,
  CatalogUpdatesResponse,
  Course,
  CourseRefreshPendingResponse,
  CourseRefreshRequest,
  CourseRefreshResponse,
} from "@better-ttb/shared";

import { extractLiveCourse } from "@/lib/live-course";
import type { Env } from "./env";
import { sessionKey } from "./catalog-storage";
import { getCoursesByCode } from "./ttb-client";

const LIVE_REFRESH_COOLDOWN_MS = 30 * 60_000;
const LIVE_REFRESH_CLAIM_MS = 120_000;
const DELTA_LIMIT = 500;

export class CourseRefreshAdmissionError extends Error {
  constructor(
    readonly status: 429 | 503,
    readonly code: "rate_limited" | "rate_limit_unavailable",
    readonly retryAfterSeconds: number,
  ) {
    super(code);
    this.name = "CourseRefreshAdmissionError";
  }
}

interface StoredCourseRow {
  id: string;
  code: string;
  section_code: string;
  session: string;
  data_json: string;
  updated_at: string;
  live_refreshed_at: string | null;
  live_refresh_claimed_at: string | null;
}

interface DeltaCourseRow {
  id: string;
  data_json: string;
  updated_at: string;
}

export type RefreshCourseResult =
  | { status: 200; body: CourseRefreshResponse }
  | { status: 202; body: CourseRefreshPendingResponse };

interface RefreshCourseOptions {
  now?: () => Date;
  getCourses?: typeof getCoursesByCode;
  beforeUpstreamFetch?: () => Promise<void>;
}

export function parseCourseRefreshRequest(
  value: unknown,
): CourseRefreshRequest | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    typeof value.sectionCode !== "string" ||
    value.sectionCode.trim().length === 0 ||
    !Array.isArray(value.sessions) ||
    !value.sessions.every((session) => typeof session === "string")
  ) {
    return null;
  }
  const sessions = normalizeCourseSessions(value.sessions);
  if (sessions.length === 0) {
    return null;
  }
  return {
    id: value.id.trim(),
    sectionCode: value.sectionCode.trim(),
    sessions,
  };
}

export async function refreshStoredCourse(
  env: Pick<Env, "DB">,
  code: string,
  input: CourseRefreshRequest,
  options: RefreshCourseOptions = {},
): Promise<RefreshCourseResult | null> {
  const now = options.now?.() ?? new Date();
  let row = await readStoredCourse(
    env.DB,
    input.id,
    code,
    input.sectionCode,
    input.sessions,
  );
  if (!row) {
    return null;
  }

  if (isRecent(row.live_refreshed_at, now, LIVE_REFRESH_COOLDOWN_MS)) {
    return {
      status: 200,
      body: {
        course: parseStoredCourse(row.data_json),
        updatedAt: row.updated_at,
        cached: true,
      },
    };
  }

  const claimedAt = now.toISOString();
  const claimExpiresBefore = new Date(
    now.getTime() - LIVE_REFRESH_CLAIM_MS,
  ).toISOString();
  const claim = await env.DB.prepare(
    `UPDATE courses
     SET live_refresh_claimed_at = ?
     WHERE id = ? AND code = ? AND section_code = ? AND session = ?
       AND (live_refresh_claimed_at IS NULL OR live_refresh_claimed_at <= ?)
     RETURNING id`,
  )
    .bind(
      claimedAt,
      input.id,
      code,
      input.sectionCode,
      row.session,
      claimExpiresBefore,
    )
    .first<{ id: string }>();

  if (!claim) {
    row = await readStoredCourse(
      env.DB,
      input.id,
      code,
      input.sectionCode,
      input.sessions,
    );
    if (row && isRecent(row.live_refreshed_at, now, LIVE_REFRESH_COOLDOWN_MS)) {
      return {
        status: 200,
        body: {
          course: parseStoredCourse(row.data_json),
          updatedAt: row.updated_at,
          cached: true,
        },
      };
    }
    return {
      status: 202,
      body: { status: "in_progress", retryAfterSeconds: 2 },
    };
  }

  try {
    await options.beforeUpstreamFetch?.();
    const response = await (options.getCourses ?? getCoursesByCode)(
      code,
      input.sectionCode,
    );
    if (!response) {
      throw new Error("Live course was not found");
    }
    const liveCourse = extractLiveCourse(response, {
      id: input.id,
      code,
      sectionCode: input.sectionCode as Course["sectionCode"],
      sessions: parseStoredCourse(row.data_json).sessions,
    });
    if (!liveCourse) {
      throw new Error("Live course response did not contain an unambiguous offering");
    }
    const persistedCourse =
      liveCourse.id === row.id ? liveCourse : { ...liveCourse, id: row.id };

    const updatedAt = (options.now?.() ?? new Date()).toISOString();
    const persisted = await env.DB.prepare(
      `UPDATE courses
       SET code = ?, section_code = ?, name = ?, department = ?, data_json = ?,
           updated_at = ?, live_refreshed_at = ?, live_refresh_claimed_at = NULL
       WHERE id = ? AND session = ? AND live_refresh_claimed_at = ?`,
    )
      .bind(
        persistedCourse.code,
        persistedCourse.sectionCode,
        persistedCourse.name,
        persistedCourse.department.name,
        JSON.stringify(persistedCourse),
        updatedAt,
        updatedAt,
        row.id,
        row.session,
        claimedAt,
      )
      .run();
    if (persisted.meta.changes === 0) {
      throw new Error("Course refresh claim expired before the update was persisted");
    }

    return {
      status: 200,
      body: { course: persistedCourse, updatedAt, cached: false },
    };
  } catch (error) {
    await env.DB.prepare(
      "UPDATE courses SET live_refresh_claimed_at = NULL WHERE id = ? AND live_refresh_claimed_at = ?",
    )
      .bind(row.id, claimedAt)
      .run();
    throw error;
  }
}

export async function readCatalogUpdates(
  db: D1Database,
  sessions: string[],
  cursor: CatalogDeltaCursor,
): Promise<CatalogUpdatesResponse> {
  const result = await db
    .prepare(
      `SELECT id, data_json, updated_at
       FROM courses
       WHERE session = ?
         AND (updated_at > ? OR (updated_at = ? AND id > ?))
       ORDER BY updated_at, id
       LIMIT ?`,
    )
    .bind(
      sessionKey(sessions),
      cursor.updatedAt,
      cursor.updatedAt,
      cursor.id,
      DELTA_LIMIT + 1,
    )
    .all<DeltaCourseRow>();
  const rows = result.results.slice(0, DELTA_LIMIT);
  const last = rows.at(-1);
  return {
    sessions,
    courses: rows.map((entry) => parseStoredCourse(entry.data_json)),
    nextCursor: last
      ? { updatedAt: last.updated_at, id: last.id }
      : cursor,
    hasMore: result.results.length > DELTA_LIMIT,
  };
}

async function readStoredCourse(
  db: D1Database,
  id: string,
  code: string,
  sectionCode: string,
  sessions: string[],
): Promise<StoredCourseRow | null> {
  const row = await db
    .prepare(
      `SELECT id, code, section_code, session, data_json, updated_at,
               live_refreshed_at, live_refresh_claimed_at
       FROM courses
       WHERE id = ? AND code = ? AND section_code = ?`,
    )
    .bind(id, code, sectionCode)
    .first<StoredCourseRow>();
  return row && canonicalSessionKey(row.session.split(",")) === canonicalSessionKey(sessions)
    ? row
    : null;
}

function parseStoredCourse(value: string): Course {
  return JSON.parse(value) as Course;
}

function isRecent(
  value: string | null,
  now: Date,
  thresholdMs: number,
): boolean {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && now.getTime() - timestamp < thresholdMs;
}

function normalizeCourseSessions(sessions: readonly string[]): string[] {
  return [...new Set(sessions.map((session) => session.trim()).filter(Boolean))].sort();
}

function canonicalSessionKey(sessions: readonly string[]): string {
  return normalizeCourseSessions(sessions).join(",");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
