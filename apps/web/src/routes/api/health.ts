import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => Response.json({ ok: true }),
    },
  },
});
