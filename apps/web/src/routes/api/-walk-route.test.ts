import { describe, expect, it } from "vitest";

import { BUILDING_DATA_VERSION } from "@/lib/buildings";

import { lookupBuildingRecord, walkRouteCacheKey } from "./walk-route";

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
