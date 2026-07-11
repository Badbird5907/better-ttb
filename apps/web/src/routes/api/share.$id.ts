import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { bindings } from "@/server/env";

export const Route = createFileRoute("/api/share/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const plan = await bindings.KV.get(`share:${params.id}`);

        if (!plan) {
          return Response.json({ error: "not_found" }, { status: 404 });
        }

        return new Response(plan, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "private, max-age=0",
          },
        });
      },
    },
  },
});
