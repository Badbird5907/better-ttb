/**
 * One-off: build a walking-duration matrix for all UTSG buildings using the
 * FOSSGIS OSRM instance (foot profile). Output: tools/walk-matrix.json
 *   { version, generatedAt, source, codes: string[], seconds: number[][] }
 * seconds[i][j] = walk seconds from codes[i] to codes[j] (-1 = unroutable).
 * Chunked requests (sources x destinations <= ~85x85) to respect table limits,
 * 1s pause between requests to be polite to the public server.
 */
import { readFile, writeFile } from "node:fs/promises";

const OSRM = "https://routing.openstreetmap.de/routed-foot/table/v1/foot/";
const CHUNK = 85;

const buildings = JSON.parse(
  await readFile(new URL("../apps/web/src/data/buildings.json", import.meta.url), "utf8"),
);
const codes = buildings.map((b) => b.code);
const coords = buildings.map((b) => `${b.lng},${b.lat}`);
const n = codes.length;
console.log(`buildings: ${n}`);

const seconds = Array.from({ length: n }, () => new Array(n).fill(-1));
const chunks = [];
for (let i = 0; i < n; i += CHUNK) chunks.push([i, Math.min(i + CHUNK, n)]);

for (const [srcStart, srcEnd] of chunks) {
  for (const [dstStart, dstEnd] of chunks) {
    const srcIdx = [];
    const dstIdx = [];
    for (let i = srcStart; i < srcEnd; i += 1) srcIdx.push(i);
    for (let j = dstStart; j < dstEnd; j += 1) dstIdx.push(j);
    const union = [...new Set([...srcIdx, ...dstIdx])];
    const local = new Map(union.map((globalIdx, localIdx) => [globalIdx, localIdx]));
    const url =
      OSRM +
      union.map((i) => coords[i]).join(";") +
      `?annotations=duration&sources=${srcIdx.map((i) => local.get(i)).join(";")}` +
      `&destinations=${dstIdx.map((j) => local.get(j)).join(";")}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    if (data.code !== "Ok") throw new Error(`OSRM code ${data.code}`);

    data.durations.forEach((row, si) => {
      row.forEach((value, dj) => {
        seconds[srcIdx[si]][dstIdx[dj]] = value == null ? -1 : Math.round(value);
      });
    });
    console.log(`chunk src[${srcStart}-${srcEnd}) x dst[${dstStart}-${dstEnd}) done`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// sanity: BA -> MP should be a short walk (2-6 min)
const ba = codes.indexOf("BA");
const mp = codes.indexOf("MP");
console.log("BA->MP seconds:", seconds[ba][mp]);
if (seconds[ba][mp] < 30 || seconds[ba][mp] > 900) throw new Error("BA->MP sanity check failed");

const unroutable = [];
for (let i = 0; i < n; i += 1) {
  const bad = seconds[i].filter((v) => v === -1).length;
  if (bad > n / 2) unroutable.push(codes[i]);
}
console.log("mostly-unroutable buildings:", unroutable);

await writeFile(
  new URL("./walk-matrix.json", import.meta.url),
  JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "OSRM foot profile via routing.openstreetmap.de (FOSSGIS), OpenStreetMap data (ODbL)",
    codes,
    seconds,
  }),
);
console.log("wrote tools/walk-matrix.json");
