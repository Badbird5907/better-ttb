import type { Course } from "@better-ttb/shared";

import {
  buildPageableCoursesBody,
  getPageableCourses,
  TTB_PAGE_SIZE,
} from "../ttb-client";

export const SCRAPE_CURSOR_KEY = "scrape:cursor";
const DEFAULT_MAX_PAGES = 40;
const MAX_PAGES_PER_INVOCATION = 40;
const REQUEST_DELAY_MS = 150;
const CATALOG_DIVISION = "ARTSC";

export interface RunScrapeChunkOptions {
  sessions: string[];
  maxPages?: number;
}

export interface ScrapeCursor {
  sessions: string[];
  page: number;
  total: number | null;
  runId: number;
  startedAt: string;
}

export interface ScrapeChunkResult {
  status: "running" | "complete";
  pagesDone: number;
  total: number | null;
  cursor: ScrapeCursor | null;
}

export interface CatalogArtifact {
  sessions: string[];
  scrapedAt: string;
  total: number;
  courses: Course[];
}

export interface CatalogMeta {
  etag: string;
  scrapedAt: string;
  total: number;
}

export interface ScraperStatement {
  bind(...values: unknown[]): ScraperStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface ScraperDatabase {
  prepare(query: string): ScraperStatement;
  batch<T = unknown>(statements: ScraperStatement[]): Promise<D1Result<T>[]>;
}

export interface ScraperKeyValue {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ScraperDeps {
  db: ScraperDatabase;
  kv: ScraperKeyValue;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

interface RunIdRow {
  id: number;
}

interface CourseDataRow {
  data_json: string;
}

export function createWorkerScraperDeps(
  bindings: { DB: D1Database; KV: KVNamespace },
  fetchImpl?: typeof fetch,
): ScraperDeps {
  return {
    db: {
      prepare: (query) => bindings.DB.prepare(query),
      batch: async (statements) =>
        await bindings.DB.batch(statements as D1PreparedStatement[]),
    },
    kv: bindings.KV,
    ...(fetchImpl ? { fetchImpl } : {}),
  };
}

export async function runScrapeChunk(
  options: RunScrapeChunkOptions,
  deps?: ScraperDeps,
): Promise<ScrapeChunkResult> {
  if (!deps) {
    throw new Error("runScrapeChunk requires scraper dependencies");
  }

  const sessions = normalizeSessions(options.sessions);
  const maxPages = normalizeMaxPages(options.maxPages);
  const sleep = deps.sleep ?? delay;
  const now = deps.now ?? (() => new Date());

  let cursor = await readCursor(deps.kv);

  if (!cursor || !sameSessions(cursor.sessions, sessions)) {
    cursor = await startRun(deps.db, sessions, now().toISOString());
  }

  let pagesDone = 0;

  while (pagesDone < maxPages) {
    const pageToFetch = cursor.page;
    const pageableCourse = await getPageableCourses(
      buildPageableCoursesBody({
        sessions: cursor.sessions,
        divisions: [CATALOG_DIVISION],
        page: pageToFetch,
      }),
      deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {},
    );

    await upsertCourses(
      deps.db,
      pageableCourse.courses,
      cursor.sessions,
      cursor.runId,
      now().toISOString(),
    );

    pagesDone += 1;

    const total = pageableCourse.total;
    const nextCursor: ScrapeCursor = {
      ...cursor,
      page: pageToFetch + 1,
      total,
    };

    await updateRunProgress(deps.db, nextCursor);

    if (isLastPage(pageToFetch, total, pageableCourse.courses.length)) {
      const result = await completeRun(deps, nextCursor, now().toISOString());
      return {
        status: "complete",
        pagesDone,
        total: result.total,
        cursor: null,
      };
    }

    cursor = nextCursor;
    await deps.kv.put(SCRAPE_CURSOR_KEY, JSON.stringify(cursor));

    if (pagesDone < maxPages) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return {
    status: "running",
    pagesDone,
    total: cursor.total,
    cursor,
  };
}

export function catalogKey(sessions: string[]): string {
  return `catalog:${sessionKey(sessions)}`;
}

export function catalogMetaKey(sessions: string[]): string {
  return `catalog:meta:${sessionKey(sessions)}`;
}

export function sessionKey(sessions: string[]): string {
  return normalizeSessions(sessions).join(",");
}

async function startRun(
  db: ScraperDatabase,
  sessions: string[],
  startedAt: string,
): Promise<ScrapeCursor> {
  const row = await db
    .prepare(
      "INSERT INTO scrape_runs (started_at, finished_at, pages_done, total_pages, status) VALUES (?, NULL, 0, NULL, ?) RETURNING id",
    )
    .bind(startedAt, "running")
    .first<RunIdRow>();

  if (!row) {
    throw new Error("Failed to start scrape run");
  }

  return {
    sessions,
    page: 1,
    total: null,
    runId: row.id,
    startedAt,
  };
}

async function updateRunProgress(
  db: ScraperDatabase,
  cursor: ScrapeCursor,
): Promise<void> {
  const totalPages =
    cursor.total === null ? null : Math.ceil(cursor.total / TTB_PAGE_SIZE);

  await db
    .prepare(
      "UPDATE scrape_runs SET pages_done = ?, total_pages = ?, status = ? WHERE id = ?",
    )
    .bind(cursor.page - 1, totalPages, "running", cursor.runId)
    .run();
}

async function upsertCourses(
  db: ScraperDatabase,
  courses: Course[],
  sessions: string[],
  runId: number,
  updatedAt: string,
): Promise<void> {
  if (courses.length === 0) {
    return;
  }

  const key = sessionKey(sessions);
  const statement = `
    INSERT INTO courses (
      id, code, section_code, session, name, department, data_json, updated_at, scrape_run_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      code = excluded.code,
      section_code = excluded.section_code,
      session = excluded.session,
      name = excluded.name,
      department = excluded.department,
      data_json = excluded.data_json,
      updated_at = excluded.updated_at,
      scrape_run_id = excluded.scrape_run_id
  `;

  const statements = courses.map((course) =>
    db
      .prepare(statement)
      .bind(
        course.id,
        course.code,
        course.sectionCode,
        key,
        course.name,
        course.department.name,
        JSON.stringify(course),
        updatedAt,
        runId,
      ),
  );

  await db.batch(statements);
}

async function completeRun(
  deps: ScraperDeps,
  cursor: ScrapeCursor,
  scrapedAt: string,
): Promise<CatalogMeta> {
  const courses = await readCoursesForRun(deps.db, cursor.sessions, cursor.runId);
  const total = cursor.total ?? courses.length;
  const catalog: CatalogArtifact = {
    sessions: cursor.sessions,
    scrapedAt,
    total,
    courses,
  };
  const meta: CatalogMeta = {
    etag: String(cursor.runId),
    scrapedAt,
    total,
  };

  await deps.kv.put(catalogKey(cursor.sessions), JSON.stringify(catalog));
  await deps.kv.put(catalogMetaKey(cursor.sessions), JSON.stringify(meta));
  await deps.db
    .prepare(
      "UPDATE scrape_runs SET finished_at = ?, pages_done = ?, total_pages = ?, status = ? WHERE id = ?",
    )
    .bind(
      scrapedAt,
      cursor.page - 1,
      Math.ceil(total / TTB_PAGE_SIZE),
      "complete",
      cursor.runId,
    )
    .run();
  await deps.kv.delete(SCRAPE_CURSOR_KEY);

  return meta;
}

async function readCoursesForRun(
  db: ScraperDatabase,
  sessions: string[],
  runId: number,
): Promise<Course[]> {
  const result = await db
    .prepare(
      "SELECT data_json FROM courses WHERE session = ? AND scrape_run_id = ? ORDER BY code, section_code",
    )
    .bind(sessionKey(sessions), runId)
    .all<CourseDataRow>();

  return result.results.map((row) => JSON.parse(row.data_json) as Course);
}

async function readCursor(kv: ScraperKeyValue): Promise<ScrapeCursor | null> {
  const rawCursor = await kv.get(SCRAPE_CURSOR_KEY);

  if (!rawCursor) {
    return null;
  }

  try {
    return parseCursor(JSON.parse(rawCursor) as unknown);
  } catch {
    return null;
  }
}

function parseCursor(value: unknown): ScrapeCursor | null {
  if (!isRecord(value)) {
    return null;
  }

  const sessions = value.sessions;
  const page = value.page;
  const total = value.total;
  const runId = value.runId;
  const startedAt = value.startedAt;

  if (
    !Array.isArray(sessions) ||
    !sessions.every((session) => typeof session === "string") ||
    typeof page !== "number" ||
    (typeof total !== "number" && total !== null) ||
    typeof runId !== "number" ||
    typeof startedAt !== "string"
  ) {
    return null;
  }

  return {
    sessions,
    page,
    total,
    runId,
    startedAt,
  };
}

function isLastPage(page: number, total: number, courseCount: number): boolean {
  return courseCount < TTB_PAGE_SIZE || page * TTB_PAGE_SIZE >= total;
}

function normalizeSessions(sessions: string[]): string[] {
  const normalized = sessions
    .map((session) => session.trim())
    .filter((session) => session.length > 0);

  if (normalized.length === 0) {
    throw new Error("At least one session is required");
  }

  return normalized;
}

function normalizeMaxPages(maxPages: number | undefined): number {
  return Math.min(
    MAX_PAGES_PER_INVOCATION,
    Math.max(1, Math.floor(maxPages ?? DEFAULT_MAX_PAGES)),
  );
}

function sameSessions(left: string[], right: string[]): boolean {
  return sessionKey(left) === sessionKey(right);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
