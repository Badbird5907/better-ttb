import type {
  Course,
  DivisionalEnrolmentIndicators,
  TtbPageableCourse,
  TtbPageableCoursesResponse,
} from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import {
  catalogKey,
  catalogMetaKey,
  runScrapeChunk,
  runScheduledScrape,
  SCRAPE_CURSOR_KEY,
  type CatalogArtifact,
  type ScraperDatabase,
  type ScraperDeps,
  type ScraperKeyValue,
  type ScraperStatement,
} from "./scraper";
import { csc108Course } from "./__fixtures__/ttb-pageable-csc108";

describe("runScrapeChunk", () => {
  it("starts at page 1, stops at maxPages, resumes, and assembles the catalog", async () => {
    const sessions = ["20269", "20271", "20269-20271"];
    const db = new MemoryD1();
    const kv = new MemoryKv();
    const requestBodies: unknown[] = [];
    const fetchImpl = createPageFetch(
      [
        makePage(makeCourses(1, 20), 45, 1),
        makePage(makeCourses(21, 20), 45, 2),
        makePage(makeCourses(41, 5), 45, 3),
      ],
      requestBodies,
    );
    const deps = makeDeps(db, kv, fetchImpl);

    const first = await runScrapeChunk({ sessions, maxPages: 1 }, deps);

    expect(first.status).toBe("running");
    expect(first.pagesDone).toBe(1);
    expect(first.cursor).toMatchObject({ page: 2, total: 45, runId: 1 });
    expect(requestBodies[0]).toMatchObject({ page: 1, pageSize: 20 });
    expect(db.courses.size).toBe(20);

    const second = await runScrapeChunk({ sessions, maxPages: 1 }, deps);

    expect(second.status).toBe("running");
    expect(second.cursor).toMatchObject({ page: 3, total: 45, runId: 1 });
    expect(requestBodies[1]).toMatchObject({ page: 2, pageSize: 20 });
    expect(db.courses.size).toBe(40);

    const third = await runScrapeChunk({ sessions, maxPages: 5 }, deps);

    expect(third.status).toBe("complete");
    expect(third.pagesDone).toBe(1);
    expect(third.total).toBe(45);
    expect(third.cursor).toBeNull();
    expect(requestBodies[2]).toMatchObject({ page: 3, pageSize: 20 });
    expect(kv.store.has(SCRAPE_CURSOR_KEY)).toBe(false);
    expect(db.runs.get(1)?.status).toBe("complete");

    const catalog = parseCatalog(kv.store.get(catalogKey(sessions)));
    expect(catalog.sessions).toEqual(sessions);
    expect(catalog.total).toBe(45);
    expect(catalog.courses).toHaveLength(45);
  });

  it("keeps course upserts idempotent by id", async () => {
    const sessions = ["20269"];
    const db = new MemoryD1();
    const kv = new MemoryKv();
    const duplicate = makeCourse(1);
    const duplicateAgain = structuredClone(duplicate) as Course;
    const fetchImpl = createPageFetch([
      makePage([duplicate, duplicateAgain], 2, 1),
    ]);

    const result = await runScrapeChunk(
      { sessions, maxPages: 1 },
      makeDeps(db, kv, fetchImpl),
    );

    expect(result.status).toBe("complete");
    expect(db.courses.size).toBe(1);

    const catalog = parseCatalog(kv.store.get(catalogKey(sessions)));
    expect(catalog.courses).toHaveLength(1);
    expect(catalog.courses[0]?.id).toBe(duplicate.id);
  });

  it("replaces the complete stored course payload on a later scrape", async () => {
    const sessions = ["20269"];
    const db = new MemoryD1();
    const kv = new MemoryKv();
    const original = makeCourse(1);

    await runScrapeChunk(
      { sessions, maxPages: 1 },
      makeDeps(db, kv, createPageFetch([makePage([original], 1, 1)])),
    );

    const updated = structuredClone(original) as Course;
    updated.sections[0]!.instructors = [{ firstName: "New", lastName: "Lecturer" }];
    updated.sections[0]!.meetingTimes = [];
    updated.sections.push({
      ...structuredClone(updated.sections[0]!),
      name: "TUT0201",
      teachMethod: "TUT",
      sectionNumber: "0201",
    });

    await runScrapeChunk(
      { sessions, maxPages: 1 },
      makeDeps(db, kv, createPageFetch([makePage([updated], 1, 1)])),
    );

    const catalog = parseCatalog(kv.store.get(catalogKey(sessions)));
    expect(catalog.courses[0]?.sections).toHaveLength(2);
    expect(catalog.courses[0]?.sections[0]).toMatchObject({
      instructors: [{ firstName: "New", lastName: "Lecturer" }],
      meetingTimes: [],
    });
  });

  it("skips a scheduled scrape while the published catalog is fresh", async () => {
    const sessions = ["20269"];
    const db = new MemoryD1();
    const kv = new MemoryKv();
    kv.store.set(
      catalogMetaKey(sessions),
      JSON.stringify({
        etag: "1",
        scrapedAt: "2026-07-10T12:00:00.000Z",
        total: 1,
      }),
    );
    const fetchImpl: typeof fetch = async () => {
      throw new Error("Fresh scheduled scrape should not fetch");
    };

    const result = await runScheduledScrape(
      { sessions },
      {
        ...makeDeps(db, kv, fetchImpl),
        now: () => new Date("2026-07-11T11:59:59.000Z"),
      },
    );

    expect(result).toBeNull();
    expect(db.runs.size).toBe(0);
  });

  it("starts a scheduled scrape when the catalog is at least 24 hours old", async () => {
    const sessions = ["20269"];
    const db = new MemoryD1();
    const kv = new MemoryKv();
    kv.store.set(
      catalogMetaKey(sessions),
      JSON.stringify({
        etag: "1",
        scrapedAt: "2026-07-10T12:00:00.000Z",
        total: 1,
      }),
    );

    const result = await runScheduledScrape(
      { sessions, maxPages: 1 },
      {
        ...makeDeps(
          db,
          kv,
          createPageFetch([makePage([makeCourse(1)], 1, 1)]),
        ),
        now: () => new Date("2026-07-11T12:00:00.000Z"),
      },
    );

    expect(result?.status).toBe("complete");
    expect(db.runs.size).toBe(1);
  });

  it("accumulates divisionalEnrolmentIndicators into the catalog artifact", async () => {
    const sessions = ["20269"];
    const db = new MemoryD1();
    const kv = new MemoryKv();
    const fetchImpl = createPageFetch(
      [
        makePage(makeCourses(1, 20), 25, 1),
        makePage(makeCourses(21, 5), 25, 2),
      ],
      [],
      [
        { ARTSC: [{ code: "P", name: "Priority enrolment." }] },
        {
          ARTSC: [{ code: "P", name: "Priority enrolment." }],
          APSC: [{ code: "R1", name: "Reserved." }],
        },
      ],
    );

    const first = await runScrapeChunk(
      { sessions, maxPages: 1 },
      makeDeps(db, kv, fetchImpl),
    );
    expect(first.status).toBe("running");

    // Old-style cursor without the field must still resume; the persisted
    // cursor already carries the accumulated indicators though.
    const cursor = JSON.parse(
      kv.store.get(SCRAPE_CURSOR_KEY) ?? "{}",
    ) as Record<string, unknown>;
    expect(cursor.divisionalEnrolmentIndicators).toEqual({
      ARTSC: [{ code: "P", name: "Priority enrolment." }],
    });

    const second = await runScrapeChunk(
      { sessions, maxPages: 1 },
      makeDeps(db, kv, fetchImpl),
    );
    expect(second.status).toBe("complete");

    const catalog = parseCatalog(kv.store.get(catalogKey(sessions)));
    expect(catalog.divisionalEnrolmentIndicators).toEqual({
      ARTSC: [{ code: "P", name: "Priority enrolment." }],
      APSC: [{ code: "R1", name: "Reserved." }],
    });
  });

  it("omits divisionalEnrolmentIndicators when the API returns none", async () => {
    const sessions = ["20269"];
    const db = new MemoryD1();
    const kv = new MemoryKv();
    const fetchImpl = createPageFetch([makePage(makeCourses(1, 3), 3, 1)]);

    const result = await runScrapeChunk(
      { sessions, maxPages: 1 },
      makeDeps(db, kv, fetchImpl),
    );
    expect(result.status).toBe("complete");

    const catalog = parseCatalog(kv.store.get(catalogKey(sessions)));
    expect(catalog.divisionalEnrolmentIndicators).toBeUndefined();
  });

  it("resumes from an old cursor JSON that lacks the indicators field", async () => {
    const sessions = ["20269"];
    const db = new MemoryD1();
    const kv = new MemoryKv();

    // Seed a legacy cursor (no divisionalEnrolmentIndicators) for run 1.
    db.createRun("2026-07-10T12:00:00.000Z", "running");
    kv.store.set(
      SCRAPE_CURSOR_KEY,
      JSON.stringify({
        sessions,
        page: 1,
        total: null,
        runId: 1,
        startedAt: "2026-07-10T12:00:00.000Z",
      }),
    );

    const fetchImpl = createPageFetch(
      [makePage(makeCourses(1, 2), 2, 1)],
      [],
      [{ ARTSC: [{ code: "P", name: "Priority enrolment." }] }],
    );

    const result = await runScrapeChunk(
      { sessions, maxPages: 1 },
      makeDeps(db, kv, fetchImpl),
    );

    expect(result.status).toBe("complete");
    const catalog = parseCatalog(kv.store.get(catalogKey(sessions)));
    expect(catalog.divisionalEnrolmentIndicators).toEqual({
      ARTSC: [{ code: "P", name: "Priority enrolment." }],
    });
  });
});

function makeDeps(
  db: MemoryD1,
  kv: MemoryKv,
  fetchImpl: typeof fetch,
): ScraperDeps {
  return {
    db,
    kv,
    fetchImpl,
    sleep: async () => undefined,
    now: () => new Date("2026-07-10T12:00:00.000Z"),
  };
}

function makePage(
  courses: Course[],
  total: number,
  page: number,
): TtbPageableCourse {
  return {
    courses,
    total,
    page,
    pageSize: 20,
    direction: "asc",
  };
}

function makeCourses(start: number, count: number): Course[] {
  return Array.from({ length: count }, (_, index) => makeCourse(start + index));
}

function makeCourse(index: number): Course {
  const course = structuredClone(csc108Course) as Course;
  course.id = `course-${index}`;
  course.code = `CSC${String(index).padStart(3, "0")}H1`;
  course.sectionCode = index % 2 === 0 ? "S" : "F";
  course.name = `Course ${index}`;

  return course;
}

function createPageFetch(
  pages: TtbPageableCourse[],
  requestBodies: unknown[] = [],
  indicatorsByPage: Array<DivisionalEnrolmentIndicators | undefined> = [],
): typeof fetch {
  let index = 0;

  return async (_input, init) => {
    const page = pages[index];

    if (!page) {
      throw new Error(`Unexpected fetch call ${index + 1}`);
    }

    const indicators = indicatorsByPage[index];
    requestBodies.push(JSON.parse(String(init?.body)) as unknown);
    index += 1;

    const response: TtbPageableCoursesResponse = {
      payload: {
        pageableCourse: page,
        ...(indicators ? { divisionalEnrolmentIndicators: indicators } : {}),
      },
      status: [],
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function parseCatalog(value: string | undefined): CatalogArtifact {
  if (!value) {
    throw new Error("Expected catalog to be present");
  }

  return JSON.parse(value) as CatalogArtifact;
}

interface StoredCourseRow {
  id: string;
  code: string;
  section_code: string;
  session: string;
  name: string;
  department: string;
  data_json: string;
  updated_at: string;
  scrape_run_id: number;
}

interface ScrapeRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  pages_done: number;
  total_pages: number | null;
  status: string;
}

class MemoryKv implements ScraperKeyValue {
  readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class MemoryD1 implements ScraperDatabase {
  readonly courses = new Map<string, StoredCourseRow>();
  readonly runs = new Map<number, ScrapeRunRow>();
  private nextRunId = 1;

  prepare(query: string): ScraperStatement {
    return new MemoryStatement(this, query, []);
  }

  async batch<T = unknown>(statements: ScraperStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];

    for (const statement of statements) {
      results.push(await statement.run<T>());
    }

    return results;
  }

  createRun(startedAt: string, status: string): number {
    const id = this.nextRunId;
    this.nextRunId += 1;
    this.runs.set(id, {
      id,
      started_at: startedAt,
      finished_at: null,
      pages_done: 0,
      total_pages: null,
      status,
    });

    return id;
  }
}

class MemoryStatement implements ScraperStatement {
  constructor(
    private readonly db: MemoryD1,
    private readonly query: string,
    private readonly values: unknown[],
  ) {}

  bind(...values: unknown[]): ScraperStatement {
    return new MemoryStatement(this.db, this.query, values);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    if (this.normalizedQuery.startsWith("INSERT INTO scrape_runs")) {
      const id = this.db.createRun(
        expectString(this.values[0]),
        expectString(this.values[1]),
      );

      return { id } as T;
    }

    throw new Error(`Unsupported first query: ${this.query}`);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (this.normalizedQuery.startsWith("UPDATE scrape_runs SET pages_done")) {
      const run = this.getRun(expectNumber(this.values[3]));
      run.pages_done = expectNumber(this.values[0]);
      run.total_pages = expectNumberOrNull(this.values[1]);
      run.status = expectString(this.values[2]);

      return d1Result<T>();
    }

    if (this.normalizedQuery.startsWith("UPDATE scrape_runs SET finished_at")) {
      const run = this.getRun(expectNumber(this.values[4]));
      run.finished_at = expectString(this.values[0]);
      run.pages_done = expectNumber(this.values[1]);
      run.total_pages = expectNumber(this.values[2]);
      run.status = expectString(this.values[3]);

      return d1Result<T>();
    }

    if (this.normalizedQuery.startsWith("INSERT INTO courses")) {
      const row: StoredCourseRow = {
        id: expectString(this.values[0]),
        code: expectString(this.values[1]),
        section_code: expectString(this.values[2]),
        session: expectString(this.values[3]),
        name: expectString(this.values[4]),
        department: expectString(this.values[5]),
        data_json: expectString(this.values[6]),
        updated_at: expectString(this.values[7]),
        scrape_run_id: expectNumber(this.values[8]),
      };

      this.db.courses.set(row.id, row);
      return d1Result<T>();
    }

    throw new Error(`Unsupported run query: ${this.query}`);
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (this.normalizedQuery.startsWith("SELECT data_json FROM courses")) {
      const session = expectString(this.values[0]);
      const runId = expectNumber(this.values[1]);
      const rows = Array.from(this.db.courses.values())
        .filter((row) => row.session === session && row.scrape_run_id === runId)
        .sort((left, right) =>
          `${left.code}:${left.section_code}`.localeCompare(
            `${right.code}:${right.section_code}`,
          ),
        )
        .map((row) => ({ data_json: row.data_json }) as T);

      return d1Result(rows);
    }

    throw new Error(`Unsupported all query: ${this.query}`);
  }

  private get normalizedQuery(): string {
    return this.query.replace(/\s+/g, " ").trim();
  }

  private getRun(id: number): ScrapeRunRow {
    const run = this.db.runs.get(id);

    if (!run) {
      throw new Error(`Run ${id} not found`);
    }

    return run;
  }
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
      changes: 0,
    },
    results,
  };
}

function expectString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Expected string, got ${String(value)}`);
  }

  return value;
}

function expectNumber(value: unknown): number {
  if (typeof value !== "number") {
    throw new Error(`Expected number, got ${String(value)}`);
  }

  return value;
}

function expectNumberOrNull(value: unknown): number | null {
  if (value === null) {
    return null;
  }

  return expectNumber(value);
}
