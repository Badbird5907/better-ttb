import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

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
