import type { Course, DivisionalEnrolmentIndicators } from "@better-ttb/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { csc108Course } from "@/server/__fixtures__/ttb-pageable-csc108";
import { useCatalogStore } from "./catalog";

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
  return (async () =>
    new Response(JSON.stringify(artifact), {
      status: 200,
      headers: { "Content-Type": "application/json", ETag: '"run-1"' },
    })) as typeof fetch;
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
  });
}

describe("catalog store", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
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
});
