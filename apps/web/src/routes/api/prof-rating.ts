import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { bindings } from "@/server/env";
import { lookupProfessorRating } from "@/server/rmp-client";

export const Route = createFileRoute("/api/prof-rating")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const first = (url.searchParams.get("first") ?? "").trim();
        const last = (url.searchParams.get("last") ?? "").trim();

        if (!first || !last) {
          return Response.json({ error: "missing_name" }, { status: 400 });
        }

        try {
          const result = await lookupProfessorRating(bindings.KV, first, last);

          return new Response(JSON.stringify(result), {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "public, max-age=3600",
            },
          });
        } catch {
          return Response.json({ error: "rmp_upstream_error" }, { status: 502 });
        }
      },
    },
  },
});
