import type { Course } from "@better-ttb/shared";
import * as React from "react";

import {
  CourseRefreshRequestError,
  useCatalogStore,
} from "@/stores/catalog";
import type { Plan } from "@/stores/plan";

const REVALIDATE_AFTER_MS = 15 * 60 * 1000;
export const COURSE_AUTO_REFRESH_AFTER_MS = 30 * 60 * 1000;
const COURSE_AUTO_REFRESH_TICK_MS = 60 * 1000;
const COURSE_AUTO_REFRESH_RETRY_MS = 5 * 60 * 1000;
const COURSE_AUTO_REFRESH_CONCURRENCY = 4;

export interface AutoRefreshTiming {
  refreshedAt: number | null;
  nextAttemptAt: number;
}

const autoRefreshTimings = new Map<string, AutoRefreshTiming>();

export function useCatalogForPlan(plan: Plan): void {
  useCatalogForSessions(plan.sessions);
  useAutoRefreshPinnedCourses(plan);
}

export function useCatalogForSessions(sessions: readonly string[] | null): void {
  const loadCatalog = useCatalogStore((state) => state.loadCatalog);
  const sessionsKey = sessions?.join(",") ?? "";

  React.useEffect(() => {
    if (sessions && sessions.length > 0) {
      void loadCatalog([...sessions]);
    }
  }, [loadCatalog, sessions, sessionsKey]);

  React.useEffect(() => {
    if (!sessions || sessions.length === 0) {
      return;
    }

    const revalidateWhenVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      const lastCheckedAt = useCatalogStore.getState().lastCheckedAt;
      const lastCheckedMillis = lastCheckedAt ? Date.parse(lastCheckedAt) : 0;

      if (
        !Number.isFinite(lastCheckedMillis) ||
        Date.now() - lastCheckedMillis >= REVALIDATE_AFTER_MS
      ) {
        void loadCatalog([...sessions]);
      }
    };

    document.addEventListener("visibilitychange", revalidateWhenVisible);
    return () => document.removeEventListener("visibilitychange", revalidateWhenVisible);
  }, [loadCatalog, sessions, sessionsKey]);
}

function useAutoRefreshPinnedCourses(plan: Plan): void {
  const status = useCatalogStore((state) => state.status);
  const sessionsKey = useCatalogStore((state) => state.sessionsKey);
  const planSessionsKey = plan.sessions.join(",");
  const pinnedSignature = plan.pinned
    .map((pinned) => offeringKey(pinned.courseCode, pinned.sectionCode))
    .sort()
    .join("|");

  React.useEffect(() => {
    if (status === "ready" && sessionsKey === planSessionsKey) {
      void refreshDuePinnedCourses(plan);
    }
  }, [pinnedSignature, plan, planSessionsKey, sessionsKey, status]);

  React.useEffect(() => {
    const refreshWhenDue = () => {
      if (document.visibilityState === "visible") {
        void refreshDuePinnedCourses(plan);
      }
    };
    const interval = window.setInterval(
      refreshWhenDue,
      COURSE_AUTO_REFRESH_TICK_MS,
    );
    document.addEventListener("visibilitychange", refreshWhenDue);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenDue);
    };
  }, [pinnedSignature, plan, planSessionsKey]);
}

async function refreshDuePinnedCourses(plan: Plan): Promise<void> {
  const state = useCatalogStore.getState();
  const planSessionsKey = plan.sessions.join(",");
  if (
    state.status !== "ready" ||
    !state.catalog ||
    !catalogSessionsMatchPlan(state.sessionsKey, plan.sessions)
  ) {
    return;
  }

  const now = Date.now();
  const courses = collectPinnedCourses(state.catalog.courses, plan).filter(
    (course) =>
      isCourseAutoRefreshDue(
        autoRefreshKey(planSessionsKey, course.id),
        now,
        autoRefreshTimings,
      ),
  );

  await runWithConcurrency(
    courses,
    COURSE_AUTO_REFRESH_CONCURRENCY,
    async (course) => {
      const key = autoRefreshKey(planSessionsKey, course.id);
      try {
        const refreshed = await useCatalogStore.getState().refreshCourse(course);
        const refreshedAt = Date.parse(refreshed.updatedAt);
        autoRefreshTimings.set(key, {
          refreshedAt: Number.isFinite(refreshedAt) ? refreshedAt : Date.now(),
          nextAttemptAt: 0,
        });
      } catch (error) {
        const retryAfterMs =
          error instanceof CourseRefreshRequestError &&
          error.retryAfterSeconds !== null
            ? error.retryAfterSeconds * 1000
            : COURSE_AUTO_REFRESH_RETRY_MS;
        const previous = autoRefreshTimings.get(key);
        autoRefreshTimings.set(key, {
          refreshedAt: previous?.refreshedAt ?? null,
          nextAttemptAt: Date.now() + retryAfterMs,
        });
      }
    },
  );
}

export function catalogSessionsMatchPlan(
  catalogSessionsKey: string | null,
  planSessions: readonly string[],
): boolean {
  return catalogSessionsKey === planSessions.join(",");
}

export function collectPinnedCourses(
  courses: readonly Course[],
  plan: Pick<Plan, "pinned">,
): Course[] {
  const coursesByOffering = new Map(
    courses.map((course) => [
      offeringKey(course.code, course.sectionCode),
      course,
    ]),
  );
  const collected = new Map<string, Course>();
  for (const pinned of plan.pinned) {
    const course = coursesByOffering.get(
      offeringKey(pinned.courseCode, pinned.sectionCode),
    );
    if (course) {
      collected.set(course.id, course);
    }
  }
  return [...collected.values()];
}

export function isCourseAutoRefreshDue(
  key: string,
  now: number,
  timings: ReadonlyMap<string, AutoRefreshTiming> = autoRefreshTimings,
): boolean {
  const timing = timings.get(key);
  if (!timing) {
    return true;
  }
  if (now < timing.nextAttemptAt) {
    return false;
  }
  return (
    timing.refreshedAt === null ||
    now - timing.refreshedAt >= COURSE_AUTO_REFRESH_AFTER_MS
  );
}

function autoRefreshKey(sessionsKey: string, courseId: string): string {
  return `${sessionsKey}:${courseId}`;
}

function offeringKey(courseCode: string, sectionCode: string): string {
  return `${courseCode}:${sectionCode}`;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        if (item !== undefined) {
          await worker(item);
        }
      }
    },
  );
  await Promise.all(workers);
}
