import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { bindings, getCourseRefreshRateLimit } from "@/server/env";
import { captureServerEvent } from "@/server/telemetry";
import {
  parseCourseRefreshRequest,
  refreshStoredCourse,
} from "@/server/catalog-courses";
import { getCoursesByCode, TtbApiError } from "@/server/ttb-client";

export const Route = createFileRoute("/api/course/$code")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const url = new URL(request.url);
          const sectionCode = url.searchParams.get("sectionCode");
          const result = sectionCode
            ? await getCoursesByCode(params.code, sectionCode)
            : await getCoursesByCode(params.code);

          if (!result) {
            return Response.json({ error: "not_found" }, { status: 404 });
          }

          return Response.json(result);
        } catch (error) {
          return upstreamErrorResponse(error);
        }
      },
      POST: async ({ params, request }) => {
        const rateLimitKey = request.headers.get("CF-Connecting-IP") ?? "local";
        let rateLimit: { success: boolean };
        try {
          rateLimit = await getCourseRefreshRateLimit().limit({ key: rateLimitKey });
        } catch (error) {
          console.error("Course refresh rate limiter unavailable", {
            message: error instanceof Error ? error.message : String(error),
          });
          return Response.json(
            { error: "rate_limit_unavailable" },
            { status: 503, headers: { "Retry-After": "60" } },
          );
        }
        if (!rateLimit.success) {
          return Response.json(
            { error: "rate_limited" },
            { status: 429, headers: { "Retry-After": "60" } },
          );
        }

        let parsed: unknown;
        try {
          parsed = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const input = parseCourseRefreshRequest(parsed);
        if (!input) {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }

        try {
          const result = await refreshStoredCourse(bindings, params.code, input);
          if (!result) {
            return Response.json({ error: "catalog_course_not_found" }, { status: 404 });
          }
          if (result.status === 200) {
            captureServerEvent("course_refresh_succeeded", {
              code: params.code,
              courseId: input.id,
              cached: result.body.cached,
            });
          }
          return Response.json(result.body, {
            status: result.status,
            ...(result.status === 202
              ? { headers: { "Retry-After": String(result.body.retryAfterSeconds) } }
              : {}),
          });
        } catch (error) {
          if (error instanceof TtbApiError) {
            return upstreamErrorResponse(error);
          }
          const message = error instanceof Error ? error.message : String(error);
          console.error("Durable course refresh failed", {
            code: params.code,
            courseId: input.id,
            message,
          });
          captureServerEvent("course_refresh_failed", {
            code: params.code,
            courseId: input.id,
            message,
          });
          return Response.json({ error: "refresh_failed" }, { status: 502 });
        }
      },
    },
  },
});

export function upstreamErrorResponse(error: unknown): Response {
  if (error instanceof TtbApiError) {
    return Response.json(
      { error: "upstream_error" },
      { status: error.status >= 500 ? 502 : error.status },
    );
  }

  throw error;
}
