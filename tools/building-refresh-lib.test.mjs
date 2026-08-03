import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  NOMINATIM_MIN_INTERVAL_MS,
  chooseUniqueGeocodeCandidate,
  collectCatalogBuildingUsage,
  createCachedNominatimGeocoder,
  parseLsmBuildingList,
  parseLsmBuildingPage,
  resolveBuildingRecords,
} from "./building-refresh-lib.mjs";

const LAWSON = {
  osm_type: "way",
  osm_id: "1545519650",
  lat: 43.6660807,
  lon: -79.3967084,
  name: "Lawson Centre for Sustainability",
  display_name: "Lawson Centre for Sustainability, Trinity Quad, Toronto, Ontario, Canada",
};

test("parses the LSM building list and selected TL page", () => {
  const list = parseLsmBuildingList(`
    <select id="P1_BLDG">
      <option value="%null%">Select a Building &gt;&gt;&gt;</option>
      <option value="BF">BF Bancroft Building</option>
      <option value="TL">TL Lawson Centre</option>
    </select>
  `);

  assert.deepEqual(list.get("TL"), {
    code: "TL",
    name: "Lawson Centre",
    address: "",
    rooms: [],
  });

  const page = parseLsmBuildingPage(
    `
      <select id="P1_BLDG"><option value="TL" selected="selected">TL Lawson Centre</option></select>
      <select id="P1_ROOM">
        <option value="%null%">Select a Room &gt;&gt;&gt;</option>
        <option value="1013">1013</option>
        <option value="1014">1014</option>
      </select>
      <td headers="ADDR">Lawson Centre<br>6 Hoskin Ave<br>Toronto, ON</td>
    `,
    "TL",
  );

  assert.deepEqual(page, {
    code: "TL",
    name: "Lawson Centre",
    address: "6 Hoskin Ave, Toronto",
    rooms: ["1013", "1014"],
  });
});

test("accepts one strong Lawson match and rejects the Trinity address centroid", () => {
  const trinity = {
    osm_type: "relation",
    osm_id: "2687",
    lat: 43.6653086,
    lon: -79.395255,
    name: "Trinity College",
    display_name: "Trinity College, 6 Hoskin Avenue, Toronto, Ontario, Canada",
  };

  assert.deepEqual(chooseUniqueGeocodeCandidate("Lawson Centre", [trinity, LAWSON]), {
    status: "accepted",
    candidate: LAWSON,
  });
  assert.equal(chooseUniqueGeocodeCandidate("Lawson Centre", [trinity]).status, "not-found");
});

test("fails ambiguous strong geocoding matches", () => {
  const result = chooseUniqueGeocodeCandidate("Lawson Centre", [
    LAWSON,
    { ...LAWSON, osm_id: "2", name: "Lawson Centre Annex" },
  ]);

  assert.equal(result.status, "ambiguous");
  assert.equal(result.candidates.length, 2);
});

test("uses cached Nominatim results and throttles sequential cache misses", async () => {
  let nowMs = 0;
  let fetchCalls = 0;
  const waits = [];
  const cache = { version: 1, entries: {} };
  const candidates = [
    { ...LAWSON },
    {
      osm_type: "way",
      osm_id: "200",
      lat: 43.66,
      lon: -79.39,
      name: "Alpha Hall",
      display_name: "Alpha Hall, Toronto, Ontario, Canada",
    },
  ];
  const geocode = createCachedNominatimGeocoder({
    cache,
    userAgent: "better-ttb-test/1.0",
    now: () => nowMs,
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
      nowMs += milliseconds;
    },
    fetchImpl: async (url) => {
      const candidate = candidates[fetchCalls++];
      return new Response(JSON.stringify([candidate]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  assert.equal((await geocode({ name: "Lawson Centre", address: "" })).status, "accepted");
  assert.equal((await geocode({ name: "Lawson Centre", address: "" })).status, "accepted");
  assert.equal(fetchCalls, 1, "the second identical lookup should use the cache");

  assert.equal((await geocode({ name: "Alpha Hall", address: "" })).status, "accepted");
  assert.equal(fetchCalls, 2);
  assert.deepEqual(waits, [NOMINATIM_MIN_INTERVAL_MS]);
});

test("expires negative cache entries after 30 days", async () => {
  const queryKey = "missing hall toronto ontario canada";
  let nowMs = Date.parse("2026-08-02T00:00:00.000Z");
  let fetchCalls = 0;
  const cache = {
    version: 1,
    entries: {
      [queryKey]: {
        fetchedAt: "2026-08-01T00:00:00.000Z",
        query: "Missing Hall, Toronto, Ontario, Canada",
        results: [],
      },
    },
  };
  const geocode = createCachedNominatimGeocoder({
    cache,
    userAgent: "better-ttb-test/1.0",
    now: () => nowMs,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response("[]", { status: 200 });
    },
  });

  assert.equal((await geocode({ name: "Missing Hall", address: "" })).status, "not-found");
  assert.equal(fetchCalls, 0);

  nowMs = Date.parse("2026-09-02T00:00:00.000Z");
  assert.equal((await geocode({ name: "Missing Hall", address: "" })).status, "not-found");
  assert.equal(fetchCalls, 1);
});

test("collects catalog codes and resolves TL, RO, ON, and unresolved codes by source", async () => {
  const usage = collectCatalogBuildingUsage({
    courses: [
      courseWithBuilding("POL106H1", "TL", ""),
      courseWithBuilding("ROM100H1", "RO", ""),
      courseWithBuilding("PHL245H1", "ON", ""),
      courseWithBuilding("BAD100H1", "ZZ", ""),
    ],
  });
  const lsmBuildings = new Map([
    ["TL", { code: "TL", name: "Lawson Centre", address: "6 Hoskin Ave, Toronto", rooms: ["1013"] }],
  ]);
  const overrides = {
    ON: { nonGeographic: true },
    RO: {
      name: "Royal Ontario Museum",
      shortName: "ROM",
      address: "100 Queen's Park, Toronto",
      concept3dId: 497525,
    },
  };
  const concept3dById = new Map([
    [497525, { id: 497525, name: "Royal Ontario Museum", lat: 43.667709, lng: -79.394775 }],
  ]);

  const { records, report } = await resolveBuildingRecords({
    existing: [],
    usage,
    lsmBuildings,
    overrides,
    concept3dById,
    geocode: async () => ({ status: "accepted", candidate: LAWSON, query: "Lawson Centre" }),
  });

  assert.deepEqual(records.map((record) => record.code), ["RO", "TL"]);
  assert.equal(records.find((record) => record.code === "TL")?.source, "lsm+nominatim-osm-way-1545519650");
  assert.equal(records.find((record) => record.code === "RO")?.source, "concept3d-live-497525");
  assert.deepEqual(report.nonGeographic, ["ON"]);
  assert.deepEqual(report.unresolved.map((entry) => entry.code), ["ZZ"]);
});

test("keeps reviewed building and walking artifacts synchronized with the app", async () => {
  const [reviewedBuildings, appBuildings, reviewedMatrix, appMatrix] = await Promise.all([
    readFile(new URL("./buildings.refreshed.json", import.meta.url), "utf8"),
    readFile(new URL("../apps/web/src/data/buildings.json", import.meta.url), "utf8"),
    readFile(new URL("./walk-matrix.json", import.meta.url), "utf8"),
    readFile(new URL("../apps/web/src/data/walk-matrix.json", import.meta.url), "utf8"),
  ]);

  assert.equal(appBuildings, reviewedBuildings);
  assert.equal(appMatrix, reviewedMatrix);
});

function courseWithBuilding(courseCode, buildingCode, buildingUrl) {
  return {
    code: courseCode,
    sections: [
      {
        meetingTimes: [
          {
            building: { buildingCode, buildingUrl },
          },
        ],
      },
    ],
  };
}
