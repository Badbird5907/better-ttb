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

/** Building coordinates + display names keyed by building code. */
export const BUILDING_INDEX: BuildingIndex = Object.fromEntries(
  (buildingsData as BuildingRecord[]).map((building) => [
    building.code,
    { name: building.name, lat: building.lat, lng: building.lng },
  ]),
);
