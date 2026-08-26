import { describe, expect, it } from "vitest";

import { BUILDING_DATA_VERSION } from "@/lib/buildings";

import {
  lookupBuildingRecord,
  osrmRequestHeaders,
  osrmRouteUrl,
  walkRouteCacheKey,
} from "./walk-route";

describe("walk-route building validation", () => {
  it("accepts TL and BF as known route endpoints", () => {
    expect(lookupBuildingRecord("tl")).toMatchObject({ code: "TL" });
    expect(lookupBuildingRecord("BF")).toMatchObject({ code: "BF" });
  });

  it("continues to reject unknown and non-geographic codes", () => {
    expect(lookupBuildingRecord("ZZ")).toBeNull();
    expect(lookupBuildingRecord("ON")).toBeNull();
  });

  it("namespaces KV routes by the vendored building-data version", () => {
    expect(walkRouteCacheKey(" oh ", "bf")).toBe(
      `route:${BUILDING_DATA_VERSION}:OH:BF`,
    );
    expect(walkRouteCacheKey("OH", "BF")).not.toContain("route:v1:");
  });
});

describe("walk-route OSRM request", () => {
  it("identifies itself, because OSRM 403s requests without a User-Agent", () => {
    expect(osrmRequestHeaders()["User-Agent"]).toMatch(/better-ttb/);
  });

  it("asks OSRM for lng,lat pairs in walking-route order", () => {
    const url = osrmRouteUrl(
      { code: "A", lat: 43.66, lng: -79.4 },
      { code: "B", lat: 43.67, lng: -79.39 },
    );

    expect(url).toContain("/-79.4,43.66;-79.39,43.67");
    expect(url).toContain("geometries=geojson");
  });
});
