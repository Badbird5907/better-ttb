/**
 * Refresh apps/web/src/data/buildings.json from authoritative sources:
 * 1. Scraped TTB catalog: every meeting's buildingUrl embeds its Concept3D
 *    location id (map.utoronto.ca/?id=1809#!m/<id>) -> buildingCode -> id map.
 * 2. Concept3D locations API (the live map.utoronto.ca backend) -> id -> lat/lng/name.
 * Falls back to the existing vendored entry for codes without a resolvable id.
 * Writes tools/buildings.refreshed.json + prints a diff report (does NOT
 * overwrite the app dataset; review then copy).
 */
import { readFile, writeFile } from "node:fs/promises";

const CATALOG_URL = "https://ttb.evanyu.dev/api/catalog";
const C3D_URL =
  "https://api.concept3d.com/locations?map=1809&key=0001085cc708b9cef47080f064612ca5";

const existing = JSON.parse(
  await readFile(new URL("../apps/web/src/data/buildings.json", import.meta.url), "utf8"),
);
const existingByCode = new Map(existing.map((b) => [b.code, b]));

const catalog = await (await fetch(CATALOG_URL)).json();
const codeToC3dId = new Map();
const codesInUse = new Set();
for (const course of catalog.courses) {
  for (const section of course.sections) {
    for (const meeting of section.meetingTimes ?? []) {
      const code = meeting.building?.buildingCode;
      if (!code) continue;
      codesInUse.add(code);
      const match = meeting.building?.buildingUrl?.match(/[#?]!?m\/(\d+)/);
      if (match) codeToC3dId.set(code, Number(match[1]));
    }
  }
}
console.log(`codes in use by courses: ${codesInUse.size}, with concept3d id: ${codeToC3dId.size}`);

const locations = await (await fetch(C3D_URL)).json();
const byId = new Map(locations.map((loc) => [loc.id, loc]));

const inTorontoBounds = (lat, lng) => lat > 43.6 && lat < 43.7 && lng > -79.42 && lng < -79.36;
const result = [];
const report = { fresh: 0, fallback: 0, added: [], moved: [], missing: [] };

const allCodes = new Set([...codesInUse, ...existingByCode.keys()]);
for (const code of [...allCodes].sort()) {
  const old = existingByCode.get(code);
  const c3dId = codeToC3dId.get(code);
  const loc = c3dId ? byId.get(c3dId) : undefined;

  if (loc && inTorontoBounds(loc.lat, loc.lng)) {
    const name =
      loc.name
        ?.replace(/^Correct rendering of\s+/i, "")
        .replace(/\s*\|\s*[A-Z0-9 &]+\s*$/, "")
        .trim() || old?.name || code;
    result.push({
      code,
      name,
      shortName: old?.shortName ?? name,
      address: old?.address ?? "",
      lat: loc.lat,
      lng: loc.lng,
      source: `concept3d-live-${c3dId}`,
    });
    report.fresh += 1;
    if (!old) report.added.push(code);
    else {
      const dist = Math.hypot((loc.lat - old.lat) * 111000, (loc.lng - old.lng) * 81000);
      if (dist > 50) report.moved.push({ code, meters: Math.round(dist) });
    }
  } else if (old) {
    result.push(old);
    report.fallback += 1;
  } else {
    report.missing.push(code);
  }
}

console.log(`fresh coords: ${report.fresh}, fallback to vendored: ${report.fallback}`);
console.log("newly added codes:", report.added.join(", ") || "none");
console.log("moved >50m:", JSON.stringify(report.moved));
console.log("codes used by courses but unresolvable (no url id, not vendored):", report.missing.join(", ") || "none");

await writeFile(
  new URL("./buildings.refreshed.json", import.meta.url),
  JSON.stringify(result, null, 2),
);
console.log(`wrote tools/buildings.refreshed.json (${result.length} buildings)`);
