import { describe, expect, it } from "vitest";

import {
  isNonGeographicMeetingBuilding,
  isOnlineOnlySection,
  meetingLocationLabel,
} from "../src/locations";

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

describe("meetingLocationLabel", () => {
  const onlineSection = { deliveryModes: [{ session: "20269", mode: "SYNC" as const }] };
  const inPersonSection = {
    deliveryModes: [{ session: "20269", mode: "INPER" as const }],
  };
  const blankBuilding = {
    buildingCode: "",
    buildingRoomNumber: "",
    buildingRoomSuffix: "",
  };

  it("reads a blank room on an online-only section as Online", () => {
    expect(meetingLocationLabel(blankBuilding, onlineSection)).toBe("Online");
  });

  it("still reports TBA when an in-person section has no room yet", () => {
    expect(meetingLocationLabel(blankBuilding, inPersonSection)).toBe("TBA");
  });

  it("treats a hybrid section's blank room as TBA, not Online", () => {
    expect(
      meetingLocationLabel(blankBuilding, {
        deliveryModes: [{ session: "20269", mode: "HYBR" as const }],
      }),
    ).toBe("TBA");
  });

  it("labels TTB's ON + LINE placeholder as Online", () => {
    expect(
      meetingLocationLabel(
        { buildingCode: "ON", buildingRoomNumber: "LINE", buildingRoomSuffix: "" },
        inPersonSection,
      ),
    ).toBe("Online");
  });

  it("joins a real building and room with the requested separator", () => {
    const building = {
      buildingCode: "BY",
      buildingRoomNumber: "301",
      buildingRoomSuffix: "",
    };

    expect(meetingLocationLabel(building, inPersonSection)).toBe("BY301");
    expect(meetingLocationLabel(building, inPersonSection, " ")).toBe("BY 301");
  });

  it("keeps a building code that has no room number", () => {
    expect(
      meetingLocationLabel(
        { buildingCode: "SS", buildingRoomNumber: "", buildingRoomSuffix: "" },
        inPersonSection,
        " ",
      ),
    ).toBe("SS");
  });
});

describe("isOnlineOnlySection", () => {
  it("is false for a section with no delivery modes at all", () => {
    expect(isOnlineOnlySection({ deliveryModes: [] })).toBe(false);
  });

  it("is false when any session meets in person", () => {
    expect(
      isOnlineOnlySection({
        deliveryModes: [
          { session: "20269", mode: "ASYNC" },
          { session: "20271", mode: "INPER" },
        ],
      }),
    ).toBe(false);
  });
});
