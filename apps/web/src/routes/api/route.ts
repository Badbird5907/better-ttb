import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import buildingsData from "@/data/buildings.json";
import { bindings } from "@/server/env";

interface BuildingRecord {
  code: string;
  lat: number;
  lng: number;
}

/** Cached walking route between two buildings. Coordinates are `[lat, lng]`. */
interface WalkRoute {
  durationSeconds: number;
  distanceMeters: number;
  coordinates: Array<[number, number]>;
}

const BUILDINGS_BY_CODE = new Map<string, BuildingRecord>(
  (buildingsData as BuildingRecord[]).map((building) => [building.code, building]),
);

const OSRM_BASE = "https://routing.openstreetmap.de/routed-foot/route/v1/foot";

export const Route = createFileRoute("/api")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const from = (url.searchParams.get("from") ?? "").trim().toUpperCase();
        const to = (url.searchParams.get("to") ?? "").trim().toUpperCase();

        const origin = BUILDINGS_BY_CODE.get(from);
        const destination = BUILDINGS_BY_CODE.get(to);

        if (!origin || !destination) {
          return Response.json({ error: "invalid_building_code" }, { status: 400 });
        }

        const headers = {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=31536000",
        };
        const key = `route:v1:${from}:${to}`;
        const cached = await bindings.KV.get(key);

        if (cached) {
          return new Response(cached, { headers });
        }

        const osrmUrl =
          `${OSRM_BASE}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
          `?overview=full&geometries=geojson&alternatives=false&steps=false`;

        let route: WalkRoute;

        try {
          const response = await fetch(osrmUrl);

          if (!response.ok) {
            return Response.json({ error: "routing_upstream_error" }, { status: 502 });
          }

          const payload = (await response.json()) as OsrmResponse;
          const parsed = parseOsrmRoute(payload);

          if (!parsed) {
            return Response.json({ error: "routing_no_route" }, { status: 502 });
          }

          route = parsed;
        } catch {
          return Response.json({ error: "routing_upstream_error" }, { status: 502 });
        }

        const body = JSON.stringify(route);
        // Permanent cache: campus walking geometry does not change.
        await bindings.KV.put(key, body);

        return new Response(body, { headers });
      },
    },
  },
});

interface OsrmResponse {
  code?: string;
  routes?: Array<{
    duration?: number;
    distance?: number;
    geometry?: { coordinates?: Array<[number, number]> };
  }>;
}

/** Converts an OSRM route (GeoJSON lon,lat) into our lat,lng {@link WalkRoute}. */
function parseOsrmRoute(payload: OsrmResponse): WalkRoute | null {
  if (payload.code && payload.code !== "Ok") {
    return null;
  }

  const route = payload.routes?.[0];
  const coordinates = route?.geometry?.coordinates;

  if (!route || !Array.isArray(coordinates) || coordinates.length === 0) {
    return null;
  }

  return {
    durationSeconds: Math.round(route.duration ?? 0),
    distanceMeters: Math.round(route.distance ?? 0),
    coordinates: coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
  };
}
