import type { ScrapeRunRecord } from "./scraper";

const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function countFailuresSinceLatestSuccess(
  recent: readonly ScrapeRunRecord[],
  now: number,
): number {
  const latestSuccessIndex = recent.findIndex(
    (run) => run.status === "complete",
  );
  const runsSinceLastSuccess = recent.slice(
    0,
    latestSuccessIndex === -1 ? undefined : latestSuccessIndex,
  );
  return runsSinceLastSuccess.filter(
    (run) =>
      run.status === "failed" &&
      now - Date.parse(run.started_at) < FAILURE_WINDOW_MS,
  ).length;
}
