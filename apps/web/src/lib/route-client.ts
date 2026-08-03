/**
 * Client-side fetcher for the `/api/walk-route` walking-route endpoint, with a
 * module-scoped in-memory cache so the same building pair is only fetched once
 * per session (the server also caches permanently in KV).
 */

import { BUILDING_DATA_VERSION } from "@/lib/buildings";

/** A walking route returned by `/api/walk-route`. Coordinates are `[lat, lng]`. */
export interface WalkRoute {
  durationSeconds: number;
  distanceMeters: number;
  coordinates: Array<[number, number]>;
}

const cache = new Map<string, WalkRoute>();

function cacheKey(from: string, to: string): string {
  return `${BUILDING_DATA_VERSION}:${from.trim().toUpperCase()}|${to.trim().toUpperCase()}`;
}

export function walkRouteRequestUrl(from: string, to: string): string {
  const params = new URLSearchParams({
    v: BUILDING_DATA_VERSION,
    from: from.trim().toUpperCase(),
    to: to.trim().toUpperCase(),
  });

  return `/api/walk-route?${params.toString()}`;
}

/**
 * Fetches the walking route between two building codes. Resolves to `null` on any
 * failure (including a 502 from OSRM) so the caller can fall back to a straight
 * line. Passing an {@link AbortSignal} lets callers cancel in-flight fetches on
 * day/term switch.
 */
export async function fetchWalkRoute(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<WalkRoute | null> {
  const key = cacheKey(from, to);
  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(
      walkRouteRequestUrl(from, to),
      signal ? { signal } : undefined,
    );

    if (!response.ok) {
      return null;
    }

    const route = (await response.json()) as WalkRoute;

    if (!Array.isArray(route.coordinates) || route.coordinates.length === 0) {
      return null;
    }

    cache.set(key, route);
    return route;
  } catch {
    return null;
  }
}
