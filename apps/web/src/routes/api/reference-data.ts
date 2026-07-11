import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { bindings } from "@/server/env";
import { getReferenceData, TtbApiError } from "@/server/ttb-client";

const REF_DATA_KEY = "refdata";
const REF_DATA_TTL_SECONDS = 60 * 60 * 24;

export const Route = createFileRoute("/api/reference-data")({
  server: {
    handlers: {
      GET: async () => {
        const cached = await bindings.KV.get(REF_DATA_KEY);
        const headers = {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=86400",
        };

        if (cached) {
          return new Response(cached, { headers });
        }

        try {
          const referenceData = await getReferenceData();
          const body = JSON.stringify(referenceData);
          await bindings.KV.put(REF_DATA_KEY, body, {
            expirationTtl: REF_DATA_TTL_SECONDS,
          });

          return new Response(body, { headers });
        } catch (error) {
          if (error instanceof TtbApiError) {
            return Response.json(
              { error: "upstream_error" },
              { status: error.status >= 500 ? 502 : error.status },
            );
          }

          throw error;
        }
      },
    },
  },
});
