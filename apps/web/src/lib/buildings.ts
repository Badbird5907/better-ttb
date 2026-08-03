import buildingsData from "@/data/buildings.json";
import type { BuildingIndex } from "@/lib/itinerary";

interface BuildingRecord {
  code: string;
  name: string;
  shortName: string;
  address: string;
  lat: number;
  lng: number;
  source: string;
}

type BuildingCoordinates = Pick<BuildingRecord, "code" | "lat" | "lng">;

/**
 * Version for route geometry cached from the vendored building coordinates.
 * Changes automatically whenever a building code or coordinate changes.
 */
export const BUILDING_DATA_VERSION = computeBuildingDataVersion(
  buildingsData as BuildingRecord[],
);

/** Building coordinates + display names keyed by building code. */
export const BUILDING_INDEX: BuildingIndex = Object.fromEntries(
  (buildingsData as BuildingRecord[]).map((building) => [
    building.code,
    { name: building.name, lat: building.lat, lng: building.lng },
  ]),
);

export function computeBuildingDataVersion(
  buildings: readonly BuildingCoordinates[],
): string {
  const input = [...buildings]
    .sort((left, right) => left.code.localeCompare(right.code))
    .map(
      (building) =>
        `${building.code.trim().toUpperCase()}:${Number(building.lat)}:${Number(building.lng)}`,
    )
    .join("|");
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `b1-${(hash >>> 0).toString(36)}`;
}
