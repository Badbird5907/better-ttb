import { describe, expect, it } from "vitest";

import buildingsData from "@/data/buildings.json";
import matrixData from "@/data/walk-matrix.json";
import { BUILDING_INDEX } from "@/lib/buildings";
import { lookupWalkSeconds, type WalkMatrix } from "@/lib/walk-matrix";

interface BuildingRecord {
  code: string;
  name: string;
  shortName: string;
  address: string;
  lat: number;
  lng: number;
  source: string;
}

const buildings = buildingsData as BuildingRecord[];
const matrix = matrixData as WalkMatrix;

describe("vendored building geography", () => {
  it("has unique valid UTSG buildings aligned exactly with the walking matrix", () => {
    const codes = buildings.map((building) => building.code);

    expect(new Set(codes).size).toBe(codes.length);
    expect(matrix.codes).toEqual(codes);
    expect(matrix.seconds).toHaveLength(codes.length);
    matrix.seconds.forEach((row) => expect(row).toHaveLength(codes.length));

    buildings.forEach((building) => {
      expect(Number.isFinite(building.lat)).toBe(true);
      expect(Number.isFinite(building.lng)).toBe(true);
      expect(building.lat).toBeGreaterThan(43.6);
      expect(building.lat).toBeLessThan(43.7);
      expect(building.lng).toBeGreaterThan(-79.42);
      expect(building.lng).toBeLessThan(-79.36);
    });
  });

  it("contains TL and RO while keeping ON out of the geographic dataset", () => {
    expect(buildings.find((building) => building.code === "TL")).toMatchObject({
      name: "Lawson Centre",
      address: "6 Hoskin Ave, Toronto",
      lat: 43.6660807,
      lng: -79.3967084,
      source: "lsm+nominatim-osm-way-1545519650",
    });
    expect(buildings.find((building) => building.code === "RO")).toMatchObject({
      name: "Royal Ontario Museum",
      shortName: "ROM",
      source: "concept3d-live-497525",
    });
    expect(BUILDING_INDEX.ON).toBeUndefined();
  });

  it("resolves the Lawson-to-Bancroft walk to roughly twelve minutes", () => {
    const seconds = lookupWalkSeconds("TL", "BF");

    expect(seconds).not.toBeNull();
    expect(seconds!).toBeGreaterThanOrEqual(10 * 60);
    expect(seconds!).toBeLessThanOrEqual(15 * 60);
  });
});
