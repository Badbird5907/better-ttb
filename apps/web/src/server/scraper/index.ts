import type { Course, DivisionalEnrolmentIndicators } from "@better-ttb/shared";

import {
  type CatalogArtifact,
  type CatalogKeyValue,
  publishCatalog,
  sessionKey,
} from "../catalog-storage";
import {
  buildPageableCoursesBody,
  getPageableCourses,
  TTB_PAGE_SIZE,
  TtbApiError,
} from "../ttb-client";
import { captureServerEvent } from "../telemetry";

export {
  catalogKey,
  catalogManifestKey,
  catalogMetaKey,
  sessionKey,
} from "../catalog-storage";
export type { CatalogArtifact } from "../catalog-storage";

export const SCRAPE_CURSOR_KEY = "scrape:cursor";
const DEFAULT_MAX_PAGES = 25;
const MAX_PAGES_PER_INVOCATION = 25;
const MAX_UPSTREAM_REQUESTS = 45;
const REQUEST_DELAY_MS = 150;
const RETRY_DELAYS_MS = [250, 1_000];
const UPSTREAM_TIMEOUT_MS = 20_000;
const CATALOG_DIVISION = "ARTSC";
/**
 * How long after a pass *starts* before the next one may begin. A pass walks
 * the whole catalog in MAX_PAGES_PER_INVOCATION chunks, so this is the ceiling
 * on how stale a published snapshot's enrolment counts can get.
 */
const SCHEDULED_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** Window for the failed-run circuit breaker, independent of the pass cadence. */
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 2 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_FAILED_RUNS_PER_DAY = 2;

export interface RunScrapeChunkOptions {
  sessions: string[];
  maxPages?: number;
  triggerSource?: "scheduled" | "manual";
}

export interface ScrapeCursor {
  sessions: string[];
  page: number;
  total: number | null;
  runId: number;
  startedAt: string;
  divisionalEnrolmentIndicators?: DivisionalEnrolmentIndicators;
}

export interface ScrapeChunkResult {
  status: "running" | "complete" | "busy" | "blocked";
  pagesDone: number;
  total: number | null;
  cursor: ScrapeCursor | null;
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

export type ScraperKeyValue = CatalogKeyValue;

export interface ScraperDeps {
  db: ScraperDatabase;
  kv: ScraperKeyValue;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface ScrapeRunRecord {
  id: number;
  started_at: string;
  finished_at: string | null;
  pages_done: number;
  total_pages: number | null;
  status: string;
  sessions: string;
  total_courses: number | null;
  last_attempt_at: string | null;
  last_progress_at: string | null;
  failure_count: number;
  last_error: string | null;
  lease_expires_at: string | null;
  trigger_source: string | null;
  indicators_json: string | null;
}

interface CourseDataRow {
  data_json: string;
}

interface CountRow {
  count: number;
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
  const key = sessionKey(sessions);
  const maxPages = normalizeMaxPages(options.maxPages);
  const sleep = deps.sleep ?? delay;
  const now = deps.now ?? (() => new Date());
  await deps.kv.delete(SCRAPE_CURSOR_KEY);

  let run = await readActiveRun(deps.db, key);
  if (!run) {
    try {
      run = await startRun(
        deps.db,
        key,
        now().toISOString(),
        options.triggerSource ?? "manual",
      );
    } catch (error) {
      // The unique running-session index may have been won by a concurrent
      // scheduled or manual invocation between our read and insert.
      run = await readActiveRun(deps.db, key);
      if (!run) {
        throw error;
      }
    }
  }

  const claimedAt = now();
  const lease = await acquireLease(deps.db, run.id, claimedAt);
  if (!lease) {
    return resultForRun("busy", run, sessions);
  }
  run = lease;

  let pagesDoneThisInvocation = 0;
  const requestBudget = { used: 0 };

  try {
    while (pagesDoneThisInvocation < maxPages) {
      const page: number = run.pages_done + 1;
      const { pageableCourse, divisionalEnrolmentIndicators } =
        await fetchPageWithRetry(
          sessions,
          page,
          deps.fetchImpl,
          sleep,
          requestBudget,
        );
      const renewedLease = await renewLease(
        deps.db,
        run.id,
        requireLease(run),
        now(),
      );
      if (!renewedLease) {
        return resultForRun("busy", run, sessions);
      }
      run = renewedLease;
      const updatedAt = now().toISOString();
      const indicators = mergeIndicators(
        parseIndicators(run.indicators_json),
        divisionalEnrolmentIndicators,
      );
      const pagesDone: number = page;
      const total = pageableCourse.total;
      const totalPages = Math.ceil(total / TTB_PAGE_SIZE);

      const committed = await commitPage(
        deps.db,
        pageableCourse.courses,
        key,
        run.id,
        run.started_at,
        updatedAt,
        pagesDone,
        total,
        totalPages,
        indicators,
        requireLease(run),
      );
      if (!committed) {
        return resultForRun("busy", run, sessions);
      }
      run = {
        ...run,
        pages_done: pagesDone,
        total_pages: totalPages,
        total_courses: total,
        last_progress_at: updatedAt,
        failure_count: 0,
        last_error: null,
        indicators_json: indicators ? JSON.stringify(indicators) : null,
      };
      pagesDoneThisInvocation += 1;

      if (isLastPage(page, total, pageableCourse.courses.length)) {
        const completionLease = await renewLease(
          deps.db,
          run.id,
          requireLease(run),
          now(),
        );
        if (!completionLease) {
          return resultForRun("busy", run, sessions);
        }
        run = completionLease;
        const snapshotCutoff = now().toISOString();
        await completeRun(
          deps,
          run,
          sessions,
          snapshotCutoff,
          now().toISOString(),
          requireLease(run),
        );
        return {
          status: "complete",
          pagesDone: pagesDoneThisInvocation,
          total,
          cursor: null,
        };
      }

      if (pagesDoneThisInvocation < maxPages) {
        await sleep(REQUEST_DELAY_MS);
      }
    }

    await releaseLease(deps.db, run.id, requireLease(run));
    console.info("Catalog scrape chunk completed", {
      runId: run.id,
      pagesDone: pagesDoneThisInvocation,
      total: run.total_courses,
      nextPage: run.pages_done + 1,
    });
    captureServerEvent("catalog_scrape_chunk_completed", {
      runId: run.id,
      pagesDone: pagesDoneThisInvocation,
      total: run.total_courses,
      nextPage: run.pages_done + 1,
    });
    return {
      status: "running",
      pagesDone: pagesDoneThisInvocation,
      total: run.total_courses,
      cursor: cursorForRun(run, sessions),
    };
  } catch (error) {
    if (error instanceof ScrapeLeaseLostError) {
      return resultForRun("busy", run, sessions);
    }
    await recordFailure(
      deps.db,
      run.id,
      requireLease(run),
      error,
      now().toISOString(),
    );
    throw error;
  }
}

export async function runScheduledScrape(
  options: RunScrapeChunkOptions,
  deps: ScraperDeps,
): Promise<ScrapeChunkResult | null> {
  const sessions = normalizeSessions(options.sessions);
  const key = sessionKey(sessions);
  const now = deps.now?.() ?? new Date();
  await deps.kv.delete(SCRAPE_CURSOR_KEY);

  const active = await readActiveRun(deps.db, key);
  if (active) {
    return await runScrapeChunk(
      { ...options, sessions, triggerSource: "scheduled" },
      deps,
    );
  }

  if (await automaticRestartsBlocked(deps.db, key, now)) {
    return { status: "blocked", pagesDone: 0, total: null, cursor: null };
  }

  const latest = await readLatestCompletedRun(deps.db, key);
  if (
    latest &&
    now.getTime() - Date.parse(latest.started_at) < SCHEDULED_REFRESH_INTERVAL_MS
  ) {
    return null;
  }

  return await runScrapeChunk(
    { ...options, sessions, triggerSource: "scheduled" },
    deps,
  );
}

export async function abandonActiveRun(
  db: ScraperDatabase,
  sessions: string[],
  now = new Date(),
  force = false,
): Promise<"abandoned" | "leased" | "none"> {
  const key = sessionKey(sessions);
  const abandoned = await db
    .prepare(
      `UPDATE scrape_runs
       SET status = 'abandoned', finished_at = ?, lease_expires_at = NULL
       WHERE sessions = ? AND status = 'running'
         AND (? = 1 OR lease_expires_at IS NULL OR lease_expires_at <= ?)
       RETURNING id`,
    )
    .bind(now.toISOString(), key, force ? 1 : 0, now.toISOString())
    .first<{ id: number }>();
  if (!abandoned) {
    return (await readActiveRun(db, key)) ? "leased" : "none";
  }
  captureServerEvent("catalog_scrape_abandoned", {
    sessions: key,
    force,
  });
  return "abandoned";
}

export async function getScrapeStatus(
  db: ScraperDatabase,
  sessions: string[],
): Promise<{ active: ScrapeRunRecord | null; recent: ScrapeRunRecord[] }> {
  const key = sessionKey(sessions);
  const [active, recent] = await Promise.all([
    readActiveRun(db, key),
    db
      .prepare(
        `SELECT * FROM scrape_runs WHERE sessions = ? ORDER BY started_at DESC LIMIT 10`,
      )
      .bind(key)
      .all<ScrapeRunRecord>(),
  ]);
  return { active, recent: recent.results };
}

async function startRun(
  db: ScraperDatabase,
  sessions: string,
  startedAt: string,
  triggerSource: "scheduled" | "manual",
): Promise<ScrapeRunRecord> {
  const row = await db
    .prepare(
      `INSERT INTO scrape_runs (
         started_at, finished_at, pages_done, total_pages, status, sessions,
         total_courses, last_attempt_at, last_progress_at, failure_count,
         last_error, lease_expires_at, trigger_source, indicators_json
       ) VALUES (?, NULL, 0, NULL, 'running', ?, NULL, NULL, NULL, 0, NULL, NULL, ?, NULL)
       RETURNING *`,
    )
    .bind(startedAt, sessions, triggerSource)
    .first<ScrapeRunRecord>();
  if (!row) {
    throw new Error("Failed to start scrape run");
  }
  console.info("Catalog scrape started", { runId: row.id, sessions, triggerSource });
  captureServerEvent("catalog_scrape_started", {
    runId: row.id,
    sessions,
    triggerSource,
  });
  return row;
}

async function acquireLease(
  db: ScraperDatabase,
  runId: number,
  now: Date,
): Promise<ScrapeRunRecord | null> {
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
  return await db
    .prepare(
      `UPDATE scrape_runs
       SET lease_expires_at = ?, last_attempt_at = ?
       WHERE id = ? AND status = 'running'
         AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
       RETURNING *`,
    )
    .bind(leaseExpiresAt, nowIso, runId, nowIso)
    .first<ScrapeRunRecord>();
}

async function renewLease(
  db: ScraperDatabase,
  runId: number,
  currentLeaseExpiresAt: string,
  now: Date,
): Promise<ScrapeRunRecord | null> {
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS).toISOString();
  return await db
    .prepare(
      `UPDATE scrape_runs
       SET lease_expires_at = ?, last_attempt_at = ?
       WHERE id = ? AND status = 'running' AND lease_expires_at = ?
       RETURNING *`,
    )
    .bind(leaseExpiresAt, nowIso, runId, currentLeaseExpiresAt)
    .first<ScrapeRunRecord>();
}

async function commitPage(
  db: ScraperDatabase,
  courses: Course[],
  sessions: string,
  runId: number,
  runStartedAt: string,
  updatedAt: string,
  pagesDone: number,
  totalCourses: number,
  totalPages: number,
  indicators: DivisionalEnrolmentIndicators | undefined,
  leaseExpiresAt: string,
): Promise<boolean> {
  const upsert = `
    INSERT INTO courses (
      id, code, section_code, session, name, department, data_json, updated_at, scrape_run_id
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM scrape_runs
      WHERE id = ? AND status = 'running' AND lease_expires_at = ?
    )
    ON CONFLICT(id) DO UPDATE SET
      code = excluded.code,
      section_code = excluded.section_code,
      session = excluded.session,
      name = CASE
        WHEN courses.live_refreshed_at >= ? THEN courses.name
        ELSE excluded.name
      END,
      department = CASE
        WHEN courses.live_refreshed_at >= ? THEN courses.department
        ELSE excluded.department
      END,
      data_json = CASE
        WHEN courses.live_refreshed_at >= ? THEN courses.data_json
        ELSE excluded.data_json
      END,
      -- updated_at drives the /api/catalog/updates delta feed, so it must only
      -- move when the payload actually differs. Bumping it on every pass turned
      -- the feed into a full re-download of the catalog.
      updated_at = CASE
        WHEN courses.live_refreshed_at >= ? THEN courses.updated_at
        WHEN courses.data_json = excluded.data_json THEN courses.updated_at
        ELSE excluded.updated_at
      END,
      scrape_run_id = excluded.scrape_run_id,
      live_refreshed_at = CASE
        WHEN courses.live_refreshed_at >= ? THEN courses.live_refreshed_at
        ELSE NULL
      END
  `;
  const statements = courses.map((course) =>
    db
      .prepare(upsert)
      .bind(
        course.id,
        course.code,
        course.sectionCode,
        sessions,
        course.name,
        course.department.name,
        JSON.stringify(course),
        updatedAt,
        runId,
        runId,
        leaseExpiresAt,
        runStartedAt,
        runStartedAt,
        runStartedAt,
        runStartedAt,
        runStartedAt,
      ),
  );
  statements.push(
    db
      .prepare(
        `UPDATE scrape_runs
         SET pages_done = ?, total_pages = ?, total_courses = ?,
             last_progress_at = ?, failure_count = 0, last_error = NULL,
             indicators_json = ?
         WHERE id = ? AND status = 'running' AND lease_expires_at = ?`,
      )
      .bind(
        pagesDone,
        totalPages,
        totalCourses,
        updatedAt,
        indicators ? JSON.stringify(indicators) : null,
        runId,
        leaseExpiresAt,
      ),
  );
  const results = await db.batch(statements);
  return (results.at(-1)?.meta.changes ?? 0) > 0;
}

async function completeRun(
  deps: ScraperDeps,
  run: ScrapeRunRecord,
  sessions: string[],
  snapshotCutoff: string,
  publishedAt: string,
  leaseExpiresAt: string,
): Promise<void> {
  const courses = await readCoursesForRun(deps.db, sessions, run.id);
  const total = run.total_courses ?? courses.length;
  const indicators = parseIndicators(run.indicators_json);
  const catalog: CatalogArtifact = {
    sessions,
    scrapedAt: snapshotCutoff,
    total,
    courses,
    ...(indicators ? { divisionalEnrolmentIndicators: indicators } : {}),
  };
  if (!(await ownsLease(deps.db, run.id, leaseExpiresAt))) {
    throw new ScrapeLeaseLostError();
  }
  const manifest = await publishCatalog(deps.kv, catalog, run.id, publishedAt);
  const completed = await deps.db
    .prepare(
      `UPDATE scrape_runs
       SET finished_at = ?, pages_done = ?, total_pages = ?, status = 'complete',
           lease_expires_at = NULL, last_error = NULL
       WHERE id = ? AND status = 'running' AND lease_expires_at = ?`,
    )
    .bind(
      publishedAt,
      run.pages_done,
      Math.ceil(total / TTB_PAGE_SIZE),
      run.id,
      leaseExpiresAt,
    )
    .run();
  if (completed.meta.changes === 0) {
    throw new ScrapeLeaseLostError();
  }
  console.info("Catalog scrape completed", {
    runId: run.id,
    total,
    scrapedAt: snapshotCutoff,
    compressedBytes: manifest.active.compressedBytes,
  });
  captureServerEvent("catalog_scrape_completed", {
    runId: run.id,
    total,
    scrapedAt: snapshotCutoff,
    compressedBytes: manifest.active.compressedBytes,
  });
}

async function readCoursesForRun(
  db: ScraperDatabase,
  sessions: string[],
  runId: number,
): Promise<Course[]> {
  const result = await db
    .prepare(
      `SELECT data_json FROM courses
       WHERE session = ? AND scrape_run_id = ?
       ORDER BY code, section_code`,
    )
    .bind(sessionKey(sessions), runId)
    .all<CourseDataRow>();
  return result.results.map((row) => JSON.parse(row.data_json) as Course);
}

async function readActiveRun(
  db: ScraperDatabase,
  sessions: string,
): Promise<ScrapeRunRecord | null> {
  return await db
    .prepare(
      `SELECT * FROM scrape_runs
       WHERE sessions = ? AND status = 'running'
       ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(sessions)
    .first<ScrapeRunRecord>();
}

async function readLatestCompletedRun(
  db: ScraperDatabase,
  sessions: string,
): Promise<ScrapeRunRecord | null> {
  return await db
    .prepare(
      `SELECT * FROM scrape_runs
       WHERE sessions = ? AND status = 'complete'
       ORDER BY started_at DESC LIMIT 1`,
    )
    .bind(sessions)
    .first<ScrapeRunRecord>();
}

async function automaticRestartsBlocked(
  db: ScraperDatabase,
  sessions: string,
  now: Date,
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - FAILURE_WINDOW_MS).toISOString();
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM scrape_runs
       WHERE sessions = ? AND status = 'failed' AND started_at >= ?`,
    )
    .bind(sessions, cutoff)
    .first<CountRow>();
  return (row?.count ?? 0) >= MAX_FAILED_RUNS_PER_DAY;
}

async function ownsLease(
  db: ScraperDatabase,
  runId: number,
  leaseExpiresAt: string,
): Promise<boolean> {
  return Boolean(
    await db
      .prepare(
        `SELECT id FROM scrape_runs
         WHERE id = ? AND status = 'running' AND lease_expires_at = ?`,
      )
      .bind(runId, leaseExpiresAt)
      .first<{ id: number }>(),
  );
}

async function releaseLease(
  db: ScraperDatabase,
  runId: number,
  leaseExpiresAt: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE scrape_runs SET lease_expires_at = NULL
       WHERE id = ? AND status = 'running' AND lease_expires_at = ?`,
    )
    .bind(runId, leaseExpiresAt)
    .run();
}

async function recordFailure(
  db: ScraperDatabase,
  runId: number,
  leaseExpiresAt: string,
  error: unknown,
  failedAt: string,
): Promise<void> {
  const message = sanitizeError(error);
  const row = await db
    .prepare(
      `UPDATE scrape_runs
       SET failure_count = failure_count + 1, last_error = ?,
           last_attempt_at = ?,
           status = CASE
             WHEN failure_count + 1 >= ? THEN 'failed'
             ELSE status
           END,
           finished_at = CASE
             WHEN failure_count + 1 >= ? THEN ?
             ELSE finished_at
           END,
           lease_expires_at = NULL
       WHERE id = ? AND status = 'running' AND lease_expires_at = ?
       RETURNING failure_count, status`,
    )
    .bind(
      message,
      failedAt,
      MAX_CONSECUTIVE_FAILURES,
      MAX_CONSECUTIVE_FAILURES,
      failedAt,
      runId,
      leaseExpiresAt,
    )
    .first<{ failure_count: number; status: string }>();
  console.error("Catalog scrape failed", { runId, message });
  captureServerEvent("catalog_scrape_failed", {
    runId,
    message,
    failureCount: row?.failure_count ?? null,
    status: row?.status ?? null,
  });
}

async function fetchPageWithRetry(
  sessions: string[],
  page: number,
  fetchImpl: typeof fetch | undefined,
  sleep: (ms: number) => Promise<void>,
  budget: { used: number },
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (budget.used >= MAX_UPSTREAM_REQUESTS) {
      throw new Error("Scrape upstream request budget exhausted");
    }
    budget.used += 1;
    try {
      return await getPageableCourses(
        buildPageableCoursesBody({ sessions, divisions: [CATALOG_DIVISION], page }),
        {
          ...(fetchImpl ? { fetchImpl } : {}),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        },
      );
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt >= RETRY_DELAYS_MS.length) {
        throw error;
      }
      await sleep(RETRY_DELAYS_MS[attempt] ?? 1_000);
    }
  }
  throw lastError;
}

function isRetryable(error: unknown): boolean {
  return !(error instanceof TtbApiError) || error.status === 429 || error.status >= 500;
}

function resultForRun(
  status: "busy" | "blocked",
  run: ScrapeRunRecord,
  sessions: string[],
): ScrapeChunkResult {
  return {
    status,
    pagesDone: 0,
    total: run.total_courses,
    cursor: cursorForRun(run, sessions),
  };
}

function cursorForRun(run: ScrapeRunRecord, sessions: string[]): ScrapeCursor {
  const indicators = parseIndicators(run.indicators_json);
  return {
    sessions,
    page: run.pages_done + 1,
    total: run.total_courses,
    runId: run.id,
    startedAt: run.started_at,
    ...(indicators ? { divisionalEnrolmentIndicators: indicators } : {}),
  };
}

function parseIndicators(
  value: string | null,
): DivisionalEnrolmentIndicators | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed)
      ? (parsed as DivisionalEnrolmentIndicators)
      : undefined;
  } catch {
    return undefined;
  }
}

function mergeIndicators(
  existing: DivisionalEnrolmentIndicators | undefined,
  incoming: DivisionalEnrolmentIndicators,
): DivisionalEnrolmentIndicators | undefined {
  const merged = { ...(existing ?? {}), ...incoming };
  return Object.keys(merged).length > 0 ? merged : undefined;
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

function sanitizeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function requireLease(run: ScrapeRunRecord): string {
  if (!run.lease_expires_at) {
    throw new ScrapeLeaseLostError();
  }
  return run.lease_expires_at;
}

class ScrapeLeaseLostError extends Error {
  constructor() {
    super("Scrape lease is no longer owned by this invocation");
    this.name = "ScrapeLeaseLostError";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
