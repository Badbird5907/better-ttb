import { describe, expect, it } from "vitest";

import { BUILDING_DATA_VERSION } from "./buildings";
import { walkRouteRequestUrl } from "./route-client";

describe("walkRouteRequestUrl", () => {
  it("includes the building-data version in the public cache URL", () => {
    const url = new URL(walkRouteRequestUrl(" oh ", "bf"), "https://example.test");

    expect(url.pathname).toBe("/api/walk-route");
    expect(url.searchParams.get("v")).toBe(BUILDING_DATA_VERSION);
    expect(url.searchParams.get("from")).toBe("OH");
    expect(url.searchParams.get("to")).toBe("BF");
  });
});
