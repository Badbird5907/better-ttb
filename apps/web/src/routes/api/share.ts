import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { bindings } from "@/server/env";

const MAX_SHARE_BYTES = 64 * 1024;
const SHARE_TTL_SECONDS = 180 * 24 * 60 * 60;
const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export const Route = createFileRoute("/api/share")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();

        if (new TextEncoder().encode(rawBody).byteLength > MAX_SHARE_BYTES) {
          return Response.json({ error: "payload_too_large" }, { status: 413 });
        }

        const parsed = parseJson(rawBody);

        if (!isRecord(parsed) || !isRecord(parsed.plan)) {
          return Response.json({ error: "invalid_plan" }, { status: 400 });
        }

        const id = createShareId();
        await bindings.KV.put(`share:${id}`, JSON.stringify(parsed.plan), {
          expirationTtl: SHARE_TTL_SECONDS,
        });

        return Response.json({ id });
      },
    },
  },
});

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function createShareId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));

  return Array.from(bytes, (byte) => BASE62_ALPHABET.charAt(byte % 62)).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
