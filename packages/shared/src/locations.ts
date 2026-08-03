import type { MeetingBuilding } from "./ttb-api";

type MeetingBuildingLocation = Pick<
  MeetingBuilding,
  "buildingCode" | "buildingRoomNumber" | "buildingRoomSuffix"
>;

/**
 * Whether a TTB building/room tuple represents a non-geographic meeting.
 *
 * TTB currently encodes an online location as building code `ON` plus room
 * number `LINE`. Normalizing the tuple instead of checking only the code keeps
 * a future physical `ON` building from being discarded accidentally.
 */
export function isNonGeographicMeetingBuilding(building: MeetingBuildingLocation): boolean {
  const location = `${building.buildingCode}${building.buildingRoomNumber}${building.buildingRoomSuffix}`
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

  return location === "ONLINE";
}
