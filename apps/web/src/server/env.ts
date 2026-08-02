import { env } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  COURSE_REFRESH_RATE_LIMIT: RateLimit;
  SESSIONS: string;
  ADMIN_TOKEN: string;
}

export const bindings = env as Env;
