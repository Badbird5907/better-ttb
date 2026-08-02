/**
 * Refresh the vendored UTSG building dataset from maintenance-only sources.
 *
 * Resolution order:
 * 1. Explicit non-geographic override.
 * 2. TTB meeting buildingUrl -> Concept3D location.
 * 3. Explicit reviewed coordinate / Concept3D override.
 * 4. Existing vendored building.
 * 5. LSM building metadata -> cached, bounded Nominatim lookup.
 *
 * The app never calls these services at runtime. This script writes the review
 * artifact tools/buildings.refreshed.json only when every geographic building
 * code is resolved.
 */
import { readFile, writeFile } from "node:fs/promises";

import {
  collectCatalogBuildingUsage,
  createCachedNominatimGeocoder,
  parseLsmBuildingList,
  parseLsmBuildingPage,
  resolveBuildingRecords,
} from "./building-refresh-lib.mjs";

const CATALOG_URL = process.env.BUILDING_CATALOG_URL ?? "https://ttb.evanyu.dev/api/catalog";
const CONCEPT3D_URL =
  process.env.CONCEPT3D_URL ??
  "https://api.concept3d.com/locations?map=1809&key=0001085cc708b9cef47080f064612ca5";
const LSM_URL =
  process.env.LSM_BUILDINGS_URL ?? "https://lsm.utoronto.ca/webapp/f?p=210:1::::::";
const NOMINATIM_BASE_URL =
  process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org";
const NOMINATIM_USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ??
  "better-ttb-building-refresh/1.0 (+https://github.com/Badbird5907/better-ttb)";

const existingPath = new URL("../apps/web/src/data/buildings.json", import.meta.url);
const overridesPath = new URL("./building-overrides.json", import.meta.url);
const cachePath = new URL("./nominatim-cache.json", import.meta.url);
const outputPath = new URL("./buildings.refreshed.json", import.meta.url);

const [existing, overrides, cache, catalog, concept3dLocations, lsmHtml] = await Promise.all([
  readJson(existingPath),
  readJson(overridesPath),
  readJson(cachePath),
  fetchJson(CATALOG_URL),
  fetchJson(CONCEPT3D_URL),
  fetchText(LSM_URL),
]);

const usage = collectCatalogBuildingUsage(catalog);
const concept3dById = new Map(concept3dLocations.map((location) => [Number(location.id), location]));
const lsmBuildings = parseLsmBuildingList(lsmHtml);
const existingCodes = new Set(existing.map((building) => building.code.toUpperCase()));

console.log(
  `catalog courses: ${catalog.courses?.length ?? 0}; codes in use: ${usage.size}; ` +
    `existing buildings: ${existing.length}; LSM buildings: ${lsmBuildings.size}`,
);

for (const [code, building] of lsmBuildings) {
  const override = overrides[code] ?? {};
  const liveConcept3dId = usage.get(code)?.concept3dId;
  const hasLiveConcept3d = liveConcept3dId && concept3dById.has(liveConcept3dId);
  const hasOverrideCoordinates =
    override.concept3dId ||
    (Number.isFinite(Number(override.lat)) && Number.isFinite(Number(override.lng)));

  if (override.nonGeographic || existingCodes.has(code) || hasLiveConcept3d || hasOverrideCoordinates) {
    continue;
  }

  const pageHtml = await fetchText(lsmBuildingUrl(code));
  lsmBuildings.set(code, parseLsmBuildingPage(pageHtml, code, building.name));
}

const geocode = createCachedNominatimGeocoder({
  cache,
  baseUrl: NOMINATIM_BASE_URL,
  userAgent: NOMINATIM_USER_AGENT,
  onCacheUpdate: async (nextCache) => {
    await writeJson(cachePath, nextCache);
  },
});

const { records, report } = await resolveBuildingRecords({
  existing,
  usage,
  lsmBuildings,
  overrides,
  concept3dById,
  geocode,
});

printReport(report);

if (report.unresolved.length > 0) {
  throw new Error(
    `Refusing to publish buildings.refreshed.json with unresolved geographic codes: ${report.unresolved
      .map((entry) => entry.code)
      .join(", ")}`,
  );
}

await writeJson(outputPath, records);
console.log(`wrote tools/buildings.refreshed.json (${records.length} buildings)`);

function lsmBuildingUrl(code) {
  const base = new URL(LSM_URL);
  base.search = `?p=210:1:::::P1_BLDG:${encodeURIComponent(code)}`;
  return base.toString();
}

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function writeJson(url, value) {
  await writeFile(url, `${JSON.stringify(value, null, 2)}\n`);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return await response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { Accept: "text/html" } });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return await response.text();
}

function printReport(report) {
  console.log(`resolved from current/override coordinates: ${report.resolved.length}`);
  console.log(
    "automatically geocoded:",
    report.geocoded.map((entry) => `${entry.code} (${entry.osmType}/${entry.osmId})`).join(", ") ||
      "none",
  );
  console.log(`existing vendored fallbacks: ${report.existing.length}`);
  console.log("non-geographic codes:", report.nonGeographic.join(", ") || "none");
  console.log(
    "unresolved geographic codes:",
    report.unresolved.map((entry) => `${entry.code} (${entry.reason})`).join(", ") || "none",
  );
}
