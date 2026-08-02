import type { Course, DivisionalEnrolmentIndicators } from "@better-ttb/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { csc108Course } from "@/server/__fixtures__/ttb-pageable-csc108";
import { useCatalogStore } from "./catalog";

const catalogCache = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/lib/idb", () => ({
  getCatalogCache: async (key: string) => catalogCache.get(key) ?? null,
  putCatalogCache: async (entry: { key: string }) => {
    catalogCache.set(entry.key, structuredClone(entry));
  },
}));

function makeArtifact(
  indicators?: DivisionalEnrolmentIndicators | unknown,
): Record<string, unknown> {
  const artifact: Record<string, unknown> = {
    sessions: ["20269"],
    scrapedAt: "2026-07-10T12:00:00.000Z",
    total: 1,
    courses: [csc108Course as Course],
  };

  if (indicators !== undefined) {
    artifact.divisionalEnrolmentIndicators = indicators;
  }

  return artifact;
}

function mockCatalogFetch(artifact: Record<string, unknown>): typeof fetch {
  return (async (input) => {
    if (String(input).includes("/api/catalog/updates")) {
      return Response.json({
        sessions: artifact.sessions,
        courses: [],
        nextCursor: { updatedAt: artifact.scrapedAt, id: "" },
        hasMore: false,
      });
    }
    return new Response(JSON.stringify(artifact), {
      status: 200,
      headers: { "Content-Type": "application/json", ETag: '"run-1"' },
    });
  }) as typeof fetch;
}

function resetStore(): void {
  useCatalogStore.setState({
    status: "idle",
    catalog: null,
    etag: null,
    error: null,
    sessionsKey: null,
    departments: [],
    levels: [],
    divisionalEnrolmentIndicators: {},
    lastCheckedAt: null,
    deltaCursor: null,
  });
}

describe("catalog store", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    catalogCache.clear();
    resetStore();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("exposes divisionalEnrolmentIndicators from a valid artifact", async () => {
    const indicators: DivisionalEnrolmentIndicators = {
      ARTSC: [{ code: "P", name: "Priority enrolment." }],
    };
    globalThis.fetch = mockCatalogFetch(makeArtifact(indicators));

    await useCatalogStore.getState().loadCatalog(["20269"]);

    const state = useCatalogStore.getState();
    expect(state.status).toBe("ready");
    expect(state.catalog?.divisionalEnrolmentIndicators).toEqual(indicators);
    expect(state.divisionalEnrolmentIndicators).toEqual(indicators);
  });

  it("defaults to an empty map when the artifact omits the field", async () => {
    globalThis.fetch = mockCatalogFetch(makeArtifact());

    await useCatalogStore.getState().loadCatalog(["20269"]);

    const state = useCatalogStore.getState();
    expect(state.status).toBe("ready");
    expect(state.catalog?.divisionalEnrolmentIndicators).toBeUndefined();
    expect(state.divisionalEnrolmentIndicators).toEqual({});
  });

  it("filters malformed indicator entries when parsing the artifact", async () => {
    globalThis.fetch = mockCatalogFetch(
      makeArtifact({
        ARTSC: [
          { code: "P", name: "Priority enrolment." },
          { code: 5, name: "bad" },
          "nope",
        ],
        APSC: "not-an-array",
      }),
    );

    await useCatalogStore.getState().loadCatalog(["20269"]);

    const state = useCatalogStore.getState();
    expect(state.divisionalEnrolmentIndicators).toEqual({
      ARTSC: [{ code: "P", name: "Priority enrolment." }],
    });
  });

  it("merges durable D1 deltas after loading the base catalog", async () => {
    const base = structuredClone(csc108Course) as Course;
    base.sections[0]!.currentEnrolment = 10;
    const updated = structuredClone(base) as Course;
    updated.sections[0]!.currentEnrolment = 55;
    const artifact = {
      ...makeArtifact(),
      courses: [base],
    };
    globalThis.fetch = (async (input) => {
      if (String(input).includes("/api/catalog/updates")) {
        return Response.json({
          sessions: ["20269"],
          courses: [updated],
          nextCursor: {
            updatedAt: "2026-07-10T13:00:00.000Z",
            id: updated.id,
          },
          hasMore: false,
        });
      }
      return new Response(JSON.stringify(artifact), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: 'W/"catalog-1"' },
      });
    }) as typeof fetch;

    await useCatalogStore.getState().loadCatalog(["20269"]);

    expect(
      useCatalogStore.getState().catalog?.courses[0]?.sections[0]
        ?.currentEnrolment,
    ).toBe(55);
  });

  it("replaces the complete matching offering during a live refresh", async () => {
    const base = structuredClone(csc108Course) as Course;
    base.code = "PHY132H1";
    base.sectionCode = "S";
    base.id = "winter-id";
    base.sessions = ["20271"];
    base.sections[0]!.name = "PRA0101";
    base.sections[0]!.teachMethod = "PRA";
    base.sections[0]!.currentEnrolment = 30;
    base.sections[0]!.maxEnrolment = 36;

    globalThis.fetch = mockCatalogFetch({
      ...makeArtifact(),
      sessions: ["20271"],
      courses: [base],
    });
    await useCatalogStore.getState().loadCatalog(["20271"]);

    const winter = structuredClone(base) as Course;
    winter.sections[0]!.currentEnrolment = 36;
    winter.sections[0]!.instructors = [{ firstName: "New", lastName: "Lecturer" }];
    winter.sections.push({
      ...structuredClone(winter.sections[0]!),
      name: "PRA0201",
      sectionNumber: "0201",
    });

    globalThis.fetch = (async () =>
      Response.json({
        course: winter,
        updatedAt: "2026-07-10T13:00:00.000Z",
        cached: false,
      })) as typeof fetch;

    await useCatalogStore.getState().refreshCourse(base);

    const refreshed = useCatalogStore.getState().catalog?.courses[0];
    expect(refreshed?.sections).toHaveLength(2);
    expect(refreshed?.sections[0]).toMatchObject({
      name: "PRA0101",
      currentEnrolment: 36,
      maxEnrolment: 36,
      instructors: [{ firstName: "New", lastName: "Lecturer" }],
    });

    resetStore();
    globalThis.fetch = (async (input) => {
      if (String(input).includes("/api/catalog/updates")) {
        return Response.json({
          sessions: ["20271"],
          courses: [],
          nextCursor: {
            updatedAt: "2026-07-10T13:00:00.000Z",
            id: "winter-id",
          },
          hasMore: false,
        });
      }
      return new Response(null, { status: 304 });
    }) as typeof fetch;
    await useCatalogStore.getState().loadCatalog(["20271"]);
    expect(useCatalogStore.getState().catalog?.courses[0]?.sections).toHaveLength(2);
  });
});
