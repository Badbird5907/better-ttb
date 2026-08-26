import type { MeetingBuilding, Section } from "./ttb-api";

export const ONLINE_LOCATION_LABEL = "Online";
export const UNKNOWN_LOCATION_LABEL = "TBA";

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

/**
 * Whether every session of `section` is delivered remotely.
 *
 * TTB leaves the building tuple blank on most online sections instead of
 * filling in its `ON`/`LINE` placeholder, so an empty room only means "not
 * scheduled yet" when the section is actually meant to meet somewhere. A
 * hybrid section keeps its physical sessions and is therefore not online-only.
 */
export function isOnlineOnlySection(
  section: Pick<Section, "deliveryModes">,
): boolean {
  return (
    section.deliveryModes.length > 0 &&
    section.deliveryModes.every(
      (deliveryMode) =>
        deliveryMode.mode === "SYNC" || deliveryMode.mode === "ASYNC",
    )
  );
}

/**
 * The place a meeting happens, as shown to a student: a building/room label
 * when TTB assigned one, "Online" when the section only ever meets remotely,
 * and "TBA" when a room is genuinely still outstanding.
 *
 * `separator` sits between the building code and the room number so callers can
 * keep their existing spacing ("BY301" vs "BY 301").
 */
export function meetingLocationLabel(
  building: MeetingBuildingLocation,
  section: Pick<Section, "deliveryModes">,
  separator = "",
): string {
  if (isNonGeographicMeetingBuilding(building)) {
    return ONLINE_LOCATION_LABEL;
  }

  const code = building.buildingCode.trim();
  const room = `${building.buildingRoomNumber}${building.buildingRoomSuffix}`.trim();

  if (code || room) {
    return `${code}${code && room ? separator : ""}${room}`;
  }

  return isOnlineOnlySection(section)
    ? ONLINE_LOCATION_LABEL
    : UNKNOWN_LOCATION_LABEL;
}
