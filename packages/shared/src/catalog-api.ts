import type { Course } from "./ttb-api";

export interface CourseRefreshRequest {
  id: string;
  sectionCode: string;
  sessions: string[];
}

export interface CourseRefreshResponse {
  course: Course;
  updatedAt: string;
  cached: boolean;
}

export interface CourseRefreshPendingResponse {
  status: "in_progress";
  retryAfterSeconds: number;
}

export interface CatalogDeltaCursor {
  updatedAt: string;
  id: string;
}

export interface CatalogUpdatesResponse {
  sessions: string[];
  courses: Course[];
  nextCursor: CatalogDeltaCursor;
  hasMore: boolean;
}

export interface CatalogHealthResponse {
  ok: boolean;
  catalog: {
    scrapedAt: string | null;
    ageSeconds: number | null;
    stale: boolean;
  };
  scrape: {
    status: string | null;
    pagesDone: number | null;
    totalPages: number | null;
    lastProgressAt: string | null;
    stalled: boolean;
  };
}
