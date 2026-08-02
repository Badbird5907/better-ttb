import { env } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  COURSE_REFRESH_RATE_LIMIT: RateLimit;
  SESSIONS: string;
  ADMIN_TOKEN: string;
}

export const bindings = env as Env;

const rateLimitBinding = (env as Partial<Env>).COURSE_REFRESH_RATE_LIMIT;
const configuredCourseRefreshRateLimit =
  rateLimitBinding && typeof rateLimitBinding.limit === "function"
    ? rateLimitBinding
    : null;

if (!configuredCourseRefreshRateLimit) {
  console.error("COURSE_REFRESH_RATE_LIMIT binding is not configured");
}

export function getCourseRefreshRateLimit(): RateLimit {
  if (!configuredCourseRefreshRateLimit) {
    throw new Error("COURSE_REFRESH_RATE_LIMIT binding is not configured");
  }
  return configuredCourseRefreshRateLimit;
}
