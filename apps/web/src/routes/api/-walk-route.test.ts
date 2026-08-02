import { describe, expect, it } from "vitest";

import { lookupBuildingRecord } from "./walk-route";

describe("walk-route building validation", () => {
  it("accepts TL and BF as known route endpoints", () => {
    expect(lookupBuildingRecord("tl")).toMatchObject({ code: "TL" });
    expect(lookupBuildingRecord("BF")).toMatchObject({ code: "BF" });
  });

  it("continues to reject unknown and non-geographic codes", () => {
    expect(lookupBuildingRecord("ZZ")).toBeNull();
    expect(lookupBuildingRecord("ON")).toBeNull();
  });
});
