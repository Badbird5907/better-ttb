import { describe, expect, it } from "vitest";

import type { ScrapeRunRecord } from "./scraper";
import { countFailuresSinceLatestSuccess } from "./scrape-health";

describe("scrape health", () => {
  it("clears the restart failure signal after a successful run", () => {
    const recent = [
      makeRun("failed", "2026-07-11T11:30:00.000Z"),
      makeRun("complete", "2026-07-11T11:00:00.000Z"),
      makeRun("failed", "2026-07-11T10:30:00.000Z"),
      makeRun("failed", "2026-07-11T10:00:00.000Z"),
    ];

    expect(
      countFailuresSinceLatestSuccess(
        recent,
        Date.parse("2026-07-11T12:00:00.000Z"),
      ),
    ).toBe(1);
  });
});

function makeRun(status: string, startedAt: string): ScrapeRunRecord {
  return {
    id: 1,
    started_at: startedAt,
    finished_at: null,
    pages_done: 0,
    total_pages: null,
    status,
    sessions: "20269",
    total_courses: null,
    last_attempt_at: null,
    last_progress_at: null,
    failure_count: 0,
    last_error: null,
    lease_expires_at: null,
    trigger_source: "scheduled",
    indicators_json: null,
  };
}
