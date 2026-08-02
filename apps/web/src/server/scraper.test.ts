import type {
  Course,
  DivisionalEnrolmentIndicators,
  TtbPageableCourse,
  TtbPageableCoursesResponse,
} from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import { readCatalogManifest } from "./catalog-storage";
import {
  abandonActiveRun,
  runScheduledScrape,
  runScrapeChunk,
  type ScrapeRunRecord,
  type ScraperDatabase,
  type ScraperDeps,
  type ScraperKeyValue,
  type ScraperStatement,
} from "./scraper";
import { csc108Course } from "./__fixtures__/ttb-pageable-csc108";

describe("D1-backed catalog scraper", () => {
  it("resumes a leased run and publishes a compressed catalog", async () => {
    const sessions = ["20269"];
    const db = new MemoryD1();
    const kv = new MemoryKv();
    const fetchImpl = createPageFetch([
      makePage(makeCourses(1, 20), 25, 1),
      makePage(makeCourses(21, 5), 25, 2),
    ]);
    const deps = makeDeps(db, kv, fetchImpl);

    const first = await runScrapeChunk({ sessions, maxPages: 1 }, deps);
    expect(first.status).toBe("running");
    expect(first.cursor).toMatchObject({ page: 2, total: 25, runId: 1 });
    expect(db.runs.get(1)?.pages_done).toBe(1);

    const second = await runScrapeChunk({ sessions, maxPages: 1 }, deps);
    expect(second.status).toBe("complete");
    expect(db.runs.get(1)?.status).toBe("complete");

    const manifest = await readCatalogManifest(kv, sessions);
    expect(manifest?.active).toMatchObject({ total: 25, encoding: "gzip" });
    const compressed = kv.binaryStore.get(manifest!.active.key);
    expect(compressed?.byteLength).toBeGreaterThan(0);
    const catalog = JSON.parse(await gunzip(compressed!)) as {
      courses: Course[];
      total: number;
    };
    expect(catalog.total).toBe(25);
    expect(catalog.courses).toHaveLength(25);
  });

  it("skips a scheduled run until 24 hours after the prior run started", async () => {
    const db = new MemoryD1();
    const kv = new MemoryKv();
    db.seedRun({
      status: "complete",
      sessions: "20269",
      started_at: "2026-07-10T12:00:00.000Z",
      finished_at: "2026-07-10T18:00:00.000Z",
    });
    const fetchImpl: typeof fetch = async () => {
      throw new Error("Fresh scheduled scrape should not fetch");
    };
    const result = await runScheduledScrape(
      { sessions: ["20269"] },
      makeDeps(db, kv, fetchImpl, "2026-07-11T11:59:59.000Z"),
    );
    expect(result).toBeNull();
  });

  it("starts the next scheduled run at the exact 24-hour boundary", async () => {
    const db = new MemoryD1();
    const kv = new MemoryKv();
    db.seedRun({
      status: "complete",
      sessions: "20269",
      started_at: "2026-07-10T12:00:00.000Z",
      finished_at: "2026-07-10T18:00:00.000Z",
    });
    const result = await runScheduledScrape(
      { sessions: ["20269"], maxPages: 1 },
      makeDeps(
        db,
        kv,
        createPageFetch([makePage([makeCourse(1)], 1, 1)]),
        "2026-07-11T12:00:00.000Z",
      ),
    );
    expect(result?.status).toBe("complete");
  });

  it("blocks automatic replacement after two recent failed runs", async () => {
    const db = new MemoryD1();
    db.seedRun({
      status: "failed",
      sessions: "20269",
      started_at: "2026-07-10T13:00:00.000Z",
    });
    db.seedRun({
      status: "failed",
      sessions: "20269",
      started_at: "2026-07-11T11:00:00.000Z",
    });
    const result = await runScheduledScrape(
      { sessions: ["20269"] },
      makeDeps(
        db,
        new MemoryKv(),
        async () => {
          throw new Error("Blocked scrape should not fetch");
        },
        "2026-07-11T12:00:00.000Z",
      ),
    );
    expect(result?.status).toBe("blocked");
  });

  it("returns busy when another invocation holds the run lease", async () => {
    const db = new MemoryD1();
    const kv = new MemoryKv();
    db.seedRun({
      status: "running",
      sessions: "20269",
      lease_expires_at: "2026-07-10T13:00:00.000Z",
    });
    const result = await runScrapeChunk(
      { sessions: ["20269"] },
      makeDeps(db, kv, createPageFetch([])),
    );
    expect(result.status).toBe("busy");
  });

  it("recovers when concurrent invocations race to create the active run", async () => {
    const db = new MemoryD1();
    const kv = new MemoryKv();
    let activeReads = 0;
    let releaseReads!: () => void;
    const readsReady = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });
    db.beforeActiveRunRead = async () => {
      activeReads += 1;
      if (activeReads === 2) {
        releaseReads();
      }
      if (activeReads <= 2) {
        await readsReady;
      }
    };

    let releaseFetch!: (response: Response) => void;
    const fetchImpl: typeof fetch = async () =>
      await new Promise<Response>((resolve) => {
        releaseFetch = resolve;
      });
    const first = runScrapeChunk(
      { sessions: ["20269"], maxPages: 1 },
      makeDeps(db, kv, fetchImpl),
    );
    const second = runScrapeChunk(
      { sessions: ["20269"], maxPages: 1 },
      makeDeps(db, kv, fetchImpl),
    );

    const busy = await Promise.race([first, second]);
    expect(busy.status).toBe("busy");
    releaseFetch(createPageResponse(makePage([makeCourse(1)], 1, 1)));
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "busy",
      "complete",
    ]);
    expect([...db.runs.values()].filter((run) => run.status === "complete")).toHaveLength(
      1,
    );
  });

  it("refuses a reset while a live lease is held unless it is forced", async () => {
    const db = new MemoryD1();
    const run = db.seedRun({
      status: "running",
      sessions: "20269",
      lease_expires_at: "2026-07-10T13:00:00.000Z",
    });

    expect(
      await abandonActiveRun(
        db,
        ["20269"],
        new Date("2026-07-10T12:00:00.000Z"),
      ),
    ).toBe("leased");
    expect(run.status).toBe("running");
    expect(
      await abandonActiveRun(
        db,
        ["20269"],
        new Date("2026-07-10T12:00:00.000Z"),
        true,
      ),
    ).toBe("abandoned");
    expect(run.status).toBe("abandoned");
  });

  it("does not commit a page after its scrape ownership is revoked", async () => {
    const db = new MemoryD1();
    const fetchImpl: typeof fetch = async () => {
      const run = db.runs.get(1)!;
      run.status = "abandoned";
      run.lease_expires_at = null;
      return createPageResponse(makePage([makeCourse(1)], 1, 1));
    };

    const result = await runScrapeChunk(
      { sessions: ["20269"], maxPages: 1 },
      makeDeps(db, new MemoryKv(), fetchImpl),
    );
    expect(result.status).toBe("busy");
    expect(db.courses.size).toBe(0);
  });

  it("passes a timeout signal to every upstream page request", async () => {
    let signal: AbortSignal | null = null;
    const fetchImpl: typeof fetch = async (_input, init) => {
      signal = init?.signal as AbortSignal;
      return createPageResponse(makePage([makeCourse(1)], 1, 1));
    };
    const result = await runScrapeChunk(
      { sessions: ["20269"], maxPages: 1 },
      makeDeps(new MemoryD1(), new MemoryKv(), fetchImpl),
    );
    expect(result.status).toBe("complete");
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps page upserts idempotent by course id", async () => {
    const db = new MemoryD1();
    const duplicate = makeCourse(1);
    const result = await runScrapeChunk(
      { sessions: ["20269"], maxPages: 1 },
      makeDeps(
        db,
        new MemoryKv(),
        createPageFetch([makePage([duplicate, structuredClone(duplicate)], 2, 1)]),
      ),
    );
    expect(result.status).toBe("complete");
    expect(db.courses.size).toBe(1);
  });

  it("accumulates divisional indicators between chunks", async () => {
    const db = new MemoryD1();
    const kv = new MemoryKv();
    const fetchImpl = createPageFetch(
      [
        makePage(makeCourses(1, 20), 25, 1),
        makePage(makeCourses(21, 5), 25, 2),
      ],
      [
        { ARTSC: [{ code: "P", name: "Priority" }] },
        { APSC: [{ code: "R", name: "Reserved" }] },
      ],
    );
    const deps = makeDeps(db, kv, fetchImpl);
    await runScrapeChunk({ sessions: ["20269"], maxPages: 1 }, deps);
    await runScrapeChunk({ sessions: ["20269"], maxPages: 1 }, deps);
    const manifest = await readCatalogManifest(kv, ["20269"]);
    const catalog = JSON.parse(
      await gunzip(kv.binaryStore.get(manifest!.active.key)!),
    ) as { divisionalEnrolmentIndicators: DivisionalEnrolmentIndicators };
    expect(catalog.divisionalEnrolmentIndicators).toEqual({
      ARTSC: [{ code: "P", name: "Priority" }],
      APSC: [{ code: "R", name: "Reserved" }],
    });
  });
});

function makeDeps(
  db: MemoryD1,
  kv: MemoryKv,
  fetchImpl: typeof fetch,
  now = "2026-07-10T12:00:00.000Z",
): ScraperDeps {
  return {
    db,
    kv,
    fetchImpl,
    sleep: async () => undefined,
    now: () => new Date(now),
  };
}

function makePage(courses: Course[], total: number, page: number): TtbPageableCourse {
  return { courses, total, page, pageSize: 20, direction: "asc" };
}

function makeCourses(start: number, count: number): Course[] {
  return Array.from({ length: count }, (_, index) => makeCourse(start + index));
}

function makeCourse(index: number): Course {
  const course = structuredClone(csc108Course) as Course;
  course.id = `course-${index}`;
  course.code = `CSC${String(index).padStart(3, "0")}H1`;
  course.name = `Course ${index}`;
  return course;
}

function createPageFetch(
  pages: TtbPageableCourse[],
  indicators: DivisionalEnrolmentIndicators[] = [],
): typeof fetch {
  return async (_input, init) => {
    const requestedPage = JSON.parse(String(init?.body)) as { page: number };
    const page = pages.find((candidate) => candidate.page === requestedPage.page);
    if (!page) {
      throw new Error(`Unexpected fetch for page ${requestedPage.page}`);
    }
    const indicator = indicators[requestedPage.page - 1];
    const response: TtbPageableCoursesResponse = {
      payload: {
        pageableCourse: page,
        ...(indicator ? { divisionalEnrolmentIndicators: indicator } : {}),
      },
      status: [],
    };
    return Response.json(response);
  };
}

function createPageResponse(page: TtbPageableCourse): Response {
  return Response.json({
    payload: { pageableCourse: page },
    status: [],
  } satisfies TtbPageableCoursesResponse);
}

class MemoryKv implements ScraperKeyValue {
  readonly store = new Map<string, string>();
  readonly binaryStore = new Map<string, ArrayBuffer>();

  async get(key: string): Promise<string | null>;
  async get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  async get(key: string, type?: "arrayBuffer"): Promise<string | ArrayBuffer | null> {
    if (type === "arrayBuffer") {
      return this.binaryStore.get(key) ?? null;
    }
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string | ArrayBuffer): Promise<void> {
    if (typeof value === "string") {
      this.store.set(key, value);
    } else {
      this.binaryStore.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
    this.binaryStore.delete(key);
  }
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

class MemoryD1 implements ScraperDatabase {
  readonly courses = new Map<string, StoredCourseRow>();
  readonly runs = new Map<number, ScrapeRunRecord>();
  beforeActiveRunRead?: () => Promise<void>;
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

  seedRun(partial: Partial<ScrapeRunRecord>): ScrapeRunRecord {
    const id = this.nextRunId++;
    const row: ScrapeRunRecord = {
      id,
      started_at: "2026-07-10T12:00:00.000Z",
      finished_at: null,
      pages_done: 0,
      total_pages: null,
      status: "running",
      sessions: "20269",
      total_courses: null,
      last_attempt_at: null,
      last_progress_at: null,
      failure_count: 0,
      last_error: null,
      lease_expires_at: null,
      trigger_source: "manual",
      indicators_json: null,
      ...partial,
    };
    this.runs.set(id, row);
    return row;
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
    const query = this.normalized;
    if (query.startsWith("SELECT * FROM scrape_runs WHERE sessions = ? AND status = 'running'")) {
      await this.db.beforeActiveRunRead?.();
      return (this.findRuns(String(this.values[0]), "running")[0] ?? null) as T | null;
    }
    if (query.startsWith("SELECT * FROM scrape_runs WHERE sessions = ? AND status = 'complete'")) {
      return (this.findRuns(String(this.values[0]), "complete")[0] ?? null) as T | null;
    }
    if (query.startsWith("SELECT COUNT(*) AS count FROM scrape_runs")) {
      const sessions = String(this.values[0]);
      const cutoff = String(this.values[1]);
      const count = [...this.db.runs.values()].filter(
        (run) => run.sessions === sessions && run.status === "failed" && run.started_at >= cutoff,
      ).length;
      return { count } as T;
    }
    if (query.startsWith("INSERT INTO scrape_runs")) {
      const sessions = String(this.values[1]);
      if (this.findRuns(sessions, "running").length > 0) {
        throw new Error("UNIQUE constraint failed: scrape_runs.sessions");
      }
      return this.db.seedRun({
        started_at: String(this.values[0]),
        sessions,
        trigger_source: String(this.values[2]),
      }) as T;
    }
    if (query.startsWith("UPDATE scrape_runs SET lease_expires_at = ?, last_attempt_at = ?")) {
      const run = this.db.runs.get(Number(this.values[2]));
      const comparison = String(this.values[3]);
      const renewing = query.includes("AND lease_expires_at = ?");
      const unavailable = renewing
        ? run?.lease_expires_at !== comparison
        : Boolean(run?.lease_expires_at && run.lease_expires_at > comparison);
      if (!run || run.status !== "running" || unavailable) {
        return null;
      }
      run.lease_expires_at = String(this.values[0]);
      run.last_attempt_at = String(this.values[1]);
      return run as T;
    }
    if (query.startsWith("UPDATE scrape_runs SET failure_count = failure_count + 1")) {
      const run = this.db.runs.get(Number(this.values[5]));
      if (
        !run ||
        run.status !== "running" ||
        run.lease_expires_at !== String(this.values[6])
      ) {
        return null;
      }
      run.failure_count += 1;
      run.last_error = String(this.values[0]);
      run.last_attempt_at = String(this.values[1]);
      run.lease_expires_at = null;
      if (run.failure_count >= Number(this.values[2])) {
        run.status = "failed";
        run.finished_at = String(this.values[4]);
      }
      return { failure_count: run.failure_count, status: run.status } as T;
    }
    if (query.startsWith("UPDATE scrape_runs SET status = 'abandoned'")) {
      const sessions = String(this.values[1]);
      const force = Number(this.values[2]) === 1;
      const now = String(this.values[3]);
      const run = this.findRuns(sessions, "running")[0];
      if (!run || (!force && run.lease_expires_at && run.lease_expires_at > now)) {
        return null;
      }
      run.status = "abandoned";
      run.finished_at = String(this.values[0]);
      run.lease_expires_at = null;
      return { id: run.id } as T;
    }
    if (query.startsWith("SELECT id FROM scrape_runs")) {
      const run = this.db.runs.get(Number(this.values[0]));
      return (run &&
      run.status === "running" &&
      run.lease_expires_at === String(this.values[1])
        ? { id: run.id }
        : null) as T | null;
    }
    throw new Error(`Unsupported first query: ${query}`);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const query = this.normalized;
    if (query.startsWith("INSERT INTO courses")) {
      const run = this.db.runs.get(Number(this.values[9]));
      if (
        !run ||
        run.status !== "running" ||
        run.lease_expires_at !== String(this.values[10])
      ) {
        return d1Result<T>([], 0);
      }
      const row: StoredCourseRow = {
        id: String(this.values[0]),
        code: String(this.values[1]),
        section_code: String(this.values[2]),
        session: String(this.values[3]),
        name: String(this.values[4]),
        department: String(this.values[5]),
        data_json: String(this.values[6]),
        updated_at: String(this.values[7]),
        scrape_run_id: Number(this.values[8]),
      };
      this.db.courses.set(row.id, row);
      return d1Result<T>([], 1);
    }
    if (query.startsWith("UPDATE scrape_runs SET pages_done = ?")) {
      const run = this.requireRun(Number(this.values[5]));
      if (
        run.status !== "running" ||
        run.lease_expires_at !== String(this.values[6])
      ) {
        return d1Result<T>([], 0);
      }
      run.pages_done = Number(this.values[0]);
      run.total_pages = Number(this.values[1]);
      run.total_courses = Number(this.values[2]);
      run.last_progress_at = String(this.values[3]);
      run.failure_count = 0;
      run.last_error = null;
      run.indicators_json = this.values[4] === null ? null : String(this.values[4]);
      return d1Result<T>([], 1);
    }
    if (query.startsWith("UPDATE scrape_runs SET finished_at = ?, pages_done = ?")) {
      const run = this.requireRun(Number(this.values[3]));
      if (
        run.status !== "running" ||
        run.lease_expires_at !== String(this.values[4])
      ) {
        return d1Result<T>([], 0);
      }
      run.finished_at = String(this.values[0]);
      run.pages_done = Number(this.values[1]);
      run.total_pages = Number(this.values[2]);
      run.status = "complete";
      run.lease_expires_at = null;
      return d1Result<T>([], 1);
    }
    if (query.startsWith("UPDATE scrape_runs SET lease_expires_at = NULL WHERE id = ?")) {
      const run = this.requireRun(Number(this.values[0]));
      if (
        run.status !== "running" ||
        run.lease_expires_at !== String(this.values[1])
      ) {
        return d1Result<T>([], 0);
      }
      run.lease_expires_at = null;
      return d1Result<T>([], 1);
    }
    throw new Error(`Unsupported run query: ${query}`);
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const query = this.normalized;
    if (query.startsWith("SELECT data_json FROM courses")) {
      const sessions = String(this.values[0]);
      const runId = Number(this.values[1]);
      return d1Result(
        [...this.db.courses.values()]
          .filter((row) => row.session === sessions && row.scrape_run_id === runId)
          .map((row) => ({ data_json: row.data_json }) as T),
      );
    }
    if (query.startsWith("SELECT * FROM scrape_runs WHERE sessions = ?")) {
      return d1Result(this.findRuns(String(this.values[0])) as T[]);
    }
    throw new Error(`Unsupported all query: ${query}`);
  }

  private findRuns(sessions: string, status?: string): ScrapeRunRecord[] {
    return [...this.db.runs.values()]
      .filter((run) => run.sessions === sessions && (!status || run.status === status))
      .sort((left, right) => right.started_at.localeCompare(left.started_at));
  }

  private requireRun(id: number): ScrapeRunRecord {
    const run = this.db.runs.get(id);
    if (!run) throw new Error(`Missing run ${id}`);
    return run;
  }

  private get normalized(): string {
    return this.query.replace(/\s+/g, " ").trim();
  }
}

function d1Result<T = unknown>(results: T[] = [], changes = 0): D1Result<T> {
  return {
    success: true,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: results.length,
      rows_written: 0,
      last_row_id: 0,
      changed_db: false,
      changes,
    },
    results,
  };
}

async function gunzip(value: ArrayBuffer): Promise<string> {
  const stream = new Blob([value]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}
