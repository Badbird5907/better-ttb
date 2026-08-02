import { describe, expect, it } from "vitest";

import { isNonGeographicMeetingBuilding } from "../src/locations";

describe("isNonGeographicMeetingBuilding", () => {
  it("recognizes TTB's ON + LINE online location", () => {
    expect(
      isNonGeographicMeetingBuilding({
        buildingCode: "ON",
        buildingRoomNumber: "LINE",
        buildingRoomSuffix: "",
      }),
    ).toBe(true);
  });

  it("normalizes whitespace and punctuation", () => {
    expect(
      isNonGeographicMeetingBuilding({
        buildingCode: " on ",
        buildingRoomNumber: "li-ne",
        buildingRoomSuffix: "",
      }),
    ).toBe(true);
  });

  it("does not discard a physical location based on the code alone", () => {
    expect(
      isNonGeographicMeetingBuilding({
        buildingCode: "ON",
        buildingRoomNumber: "101",
        buildingRoomSuffix: "",
      }),
    ).toBe(false);
  });
});
