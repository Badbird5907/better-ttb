const UTSG_BOUNDS = {
  west: -79.42,
  south: 43.64,
  east: -79.36,
  north: 43.68,
};

export const NOMINATIM_MIN_INTERVAL_MS = 1_100;
export const NOMINATIM_NEGATIVE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export function parseLsmBuildingList(html) {
  const buildings = new Map();
  const optionPattern = /<option\s+value=["']([A-Z0-9]{2,6})["'][^>]*>([\s\S]*?)<\/option>/gi;

  for (const match of html.matchAll(optionPattern)) {
    const code = match[1]?.trim().toUpperCase();
    const label = htmlToText(match[2] ?? "");

    if (!code || !label) {
      continue;
    }

    const name = label.replace(new RegExp(`^${escapeRegExp(code)}\\s+`, "i"), "").trim();
    buildings.set(code, { code, name: name || code, address: "", rooms: [] });
  }

  return buildings;
}

export function parseLsmBuildingPage(html, code, fallbackName = code) {
  const normalizedCode = code.trim().toUpperCase();
  const selectedOption = new RegExp(
    `<option\\s+value=["']${escapeRegExp(normalizedCode)}["'][^>]*selected=["']selected["'][^>]*>([\\s\\S]*?)<\\/option>`,
    "i",
  ).exec(html);
  const selectedLabel = selectedOption ? htmlToText(selectedOption[1] ?? "") : "";
  const selectedName = selectedLabel
    .replace(new RegExp(`^${escapeRegExp(normalizedCode)}\\s+`, "i"), "")
    .trim();
  const addressCell = /<td\s+[^>]*headers=["']ADDR["'][^>]*>([\s\S]*?)<\/td>/i.exec(html);
  const addressLines = addressCell ? htmlFragmentLines(addressCell[1] ?? "") : [];
  const name = selectedName || addressLines[0] || fallbackName || normalizedCode;
  const address = formatLsmAddress(addressLines, name);
  const roomSelect = /<select\s+[^>]*id=["']P1_ROOM["'][^>]*>([\s\S]*?)<\/select>/i.exec(html);
  const rooms = [];

  if (roomSelect) {
    const roomPattern = /<option\s+value=["']([^"']+)["'][^>]*>([\s\S]*?)<\/option>/gi;
    for (const match of roomSelect[1].matchAll(roomPattern)) {
      const value = decodeHtml(match[1] ?? "").trim();
      const label = htmlToText(match[2] ?? "");
      if (value && value !== "%null%" && label) {
        rooms.push(label);
      }
    }
  }

  return { code: normalizedCode, name, address, rooms: [...new Set(rooms)] };
}

export function collectCatalogBuildingUsage(catalog) {
  const usage = new Map();

  for (const course of catalog?.courses ?? []) {
    for (const section of course.sections ?? []) {
      for (const meeting of section.meetingTimes ?? []) {
        const code = meeting.building?.buildingCode?.trim().toUpperCase();
        if (!code) {
          continue;
        }

        let entry = usage.get(code);
        if (!entry) {
          entry = { code, count: 0, courseCodes: new Set(), concept3dIdCounts: new Map() };
          usage.set(code, entry);
        }

        entry.count += 1;
        if (course.code) {
          entry.courseCodes.add(course.code);
        }

        const match = meeting.building?.buildingUrl?.match(/[#?]!?m\/(\d+)/);
        if (match?.[1]) {
          const id = Number(match[1]);
          entry.concept3dIdCounts.set(id, (entry.concept3dIdCounts.get(id) ?? 0) + 1);
        }
      }
    }
  }

  return new Map(
    [...usage].map(([code, entry]) => [
      code,
      {
        code,
        count: entry.count,
        courseCodes: [...entry.courseCodes].sort(),
        concept3dId: mostFrequentId(entry.concept3dIdCounts),
      },
    ]),
  );
}

export async function resolveBuildingRecords({
  existing,
  usage,
  lsmBuildings,
  overrides,
  concept3dById,
  geocode,
}) {
  const existingByCode = new Map(existing.map((building) => [building.code.toUpperCase(), building]));
  const allCodes = new Set([
    ...existingByCode.keys(),
    ...usage.keys(),
    ...lsmBuildings.keys(),
    ...Object.keys(overrides),
  ]);
  const records = [];
  const report = {
    resolved: [],
    geocoded: [],
    existing: [],
    nonGeographic: [],
    unresolved: [],
  };

  for (const code of [...allCodes].sort()) {
    const override = overrides[code] ?? {};
    if (override.nonGeographic) {
      report.nonGeographic.push(code);
      continue;
    }

    const old = existingByCode.get(code);
    const lsm = lsmBuildings.get(code);
    const liveConcept3dId = usage.get(code)?.concept3dId;
    const liveLocation = validConcept3dLocation(concept3dById.get(liveConcept3dId));

    if (liveLocation) {
      records.push(
        buildingFromCoordinates({
          code,
          old,
          lsm,
          override,
          fallbackName: cleanConcept3dName(liveLocation.name),
          lat: liveLocation.lat,
          lng: liveLocation.lng,
          source: `concept3d-live-${liveConcept3dId}`,
        }),
      );
      report.resolved.push({ code, via: "ttb-concept3d" });
      continue;
    }

    const overrideLocation = validConcept3dLocation(concept3dById.get(override.concept3dId));
    if (overrideLocation) {
      records.push(
        buildingFromCoordinates({
          code,
          old,
          lsm,
          override,
          fallbackName: cleanConcept3dName(overrideLocation.name),
          lat: overrideLocation.lat,
          lng: overrideLocation.lng,
          source: override.source ?? `concept3d-live-${override.concept3dId}`,
        }),
      );
      report.resolved.push({ code, via: "override-concept3d" });
      continue;
    }

    if (isFiniteCoordinate(override.lat) && isFiniteCoordinate(override.lng)) {
      records.push(
        buildingFromCoordinates({
          code,
          old,
          lsm,
          override,
          fallbackName: code,
          lat: override.lat,
          lng: override.lng,
          source: override.source ?? `override-${code.toLowerCase()}`,
        }),
      );
      report.resolved.push({ code, via: "override-coordinates" });
      continue;
    }

    if (old) {
      records.push({
        ...old,
        ...(override.name ? { name: override.name.trim() } : {}),
        ...(override.shortName ? { shortName: override.shortName.trim() } : {}),
        ...(override.address ? { address: override.address.trim() } : {}),
      });
      report.existing.push(code);
      continue;
    }

    if (lsm && geocode) {
      const result = await geocode(lsm);
      if (result.status === "accepted") {
        const candidate = result.candidate;
        records.push(
          buildingFromCoordinates({
            code,
            old,
            lsm,
            override,
            fallbackName: candidate.name,
            lat: Number(candidate.lat),
            lng: Number(candidate.lon),
            source: `lsm+nominatim-osm-${candidate.osm_type}-${candidate.osm_id}`,
          }),
        );
        report.geocoded.push({ code, query: result.query, osmType: candidate.osm_type, osmId: candidate.osm_id });
        continue;
      }

      report.unresolved.push({ code, reason: result.status, candidates: result.candidates ?? [] });
      continue;
    }

    report.unresolved.push({ code, reason: "no-coordinate-source", candidates: [] });
  }

  return { records, report };
}

export function createCachedNominatimGeocoder({
  fetchImpl = fetch,
  cache,
  baseUrl = "https://nominatim.openstreetmap.org",
  userAgent,
  now = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  onCacheUpdate = async () => {},
}) {
  if (!userAgent?.trim()) {
    throw new Error("Nominatim requires an identifying User-Agent");
  }

  let lastRequestAt = null;
  const entries = cache.entries ?? (cache.entries = {});

  async function search(query) {
    const key = normalizeCacheKey(query);
    const cached = entries[key];
    if (isUsableCacheEntry(cached, now())) {
      return cached.results;
    }

    if (lastRequestAt !== null) {
      const waitMs = NOMINATIM_MIN_INTERVAL_MS - (now() - lastRequestAt);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }

    const url = createNominatimSearchUrl(baseUrl, query);
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": userAgent,
      },
    });
    lastRequestAt = now();

    if (!response.ok) {
      throw new Error(`Nominatim ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const results = normalizeNominatimResults(await response.json());
    entries[key] = { fetchedAt: new Date(now()).toISOString(), query, results };
    await onCacheUpdate(cache);
    return results;
  }

  return async function geocode(building) {
    const queries = [
      `${building.name}, Toronto, Ontario, Canada`,
      building.address ? `${building.name}, ${building.address}, Ontario, Canada` : "",
    ].filter(Boolean);
    const candidates = [];

    for (const query of [...new Set(queries)]) {
      const results = await search(query);
      candidates.push(...results.map((candidate) => ({ ...candidate, query })));
      const selection = chooseUniqueGeocodeCandidate(building.name, candidates);
      if (selection.status === "accepted") {
        return { ...selection, query };
      }
    }

    return chooseUniqueGeocodeCandidate(building.name, candidates);
  };
}

export function chooseUniqueGeocodeCandidate(expectedName, candidates) {
  const deduped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.osm_type}:${candidate.osm_id}`;
    if (!deduped.has(key)) {
      deduped.set(key, candidate);
    }
  }

  const strong = [...deduped.values()].filter((candidate) => isStrongNameMatch(expectedName, candidate.name));

  if (strong.length === 1) {
    return { status: "accepted", candidate: strong[0] };
  }

  if (strong.length > 1) {
    return { status: "ambiguous", candidates: strong };
  }

  return { status: "not-found", candidates: [...deduped.values()] };
}

export function isStrongNameMatch(expectedName, candidateName) {
  const expected = normalizeNameTokens(expectedName);
  const candidate = new Set(normalizeNameTokens(candidateName));
  if (expected.length === 0 || candidate.size === 0) {
    return false;
  }

  const matched = expected.filter((token) => candidate.has(token));
  const distinctive = expected.filter((token) => !GENERIC_BUILDING_TOKENS.has(token));
  const distinctiveMatch = distinctive.some((token) => candidate.has(token));

  return matched.length / expected.length >= 0.8 && distinctiveMatch;
}

export function createNominatimSearchUrl(baseUrl, query) {
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("search", root);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("countrycodes", "ca");
  url.searchParams.set(
    "viewbox",
    `${UTSG_BOUNDS.west},${UTSG_BOUNDS.north},${UTSG_BOUNDS.east},${UTSG_BOUNDS.south}`,
  );
  url.searchParams.set("bounded", "1");
  url.searchParams.set("q", query);
  return url;
}

function normalizeNominatimResults(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    const lat = Number(candidate?.lat);
    const lon = Number(candidate?.lon);
    const name = firstNonEmpty(
      candidate?.namedetails?.name,
      candidate?.name,
      candidate?.display_name?.split(",")[0],
      "",
    );

    if (!isInUtsgBounds(lat, lon) || !candidate?.osm_type || candidate?.osm_id == null || !name) {
      return [];
    }

    return [
      {
        osm_type: String(candidate.osm_type).toLowerCase(),
        osm_id: String(candidate.osm_id),
        lat,
        lon,
        name,
        display_name: String(candidate.display_name ?? name),
      },
    ];
  });
}

function isUsableCacheEntry(entry, nowMs) {
  if (!entry || !Array.isArray(entry.results) || !entry.fetchedAt) {
    return false;
  }

  if (entry.results.length > 0) {
    return true;
  }

  const fetchedAt = Date.parse(entry.fetchedAt);
  return Number.isFinite(fetchedAt) && nowMs - fetchedAt < NOMINATIM_NEGATIVE_CACHE_TTL_MS;
}

function buildingFromCoordinates({ code, old, lsm, override, fallbackName, lat, lng, source }) {
  const name = firstNonEmpty(override.name, old?.name, lsm?.name, fallbackName, code);
  return {
    code,
    name,
    shortName: firstNonEmpty(override.shortName, old?.shortName, lsm?.name, name),
    address: firstNonEmpty(override.address, old?.address, lsm?.address, ""),
    lat: Number(lat),
    lng: Number(lng),
    source,
  };
}

function validConcept3dLocation(location) {
  if (!location) {
    return null;
  }

  const lat = Number(location.lat);
  const lng = Number(location.lng);
  return isInTorontoBounds(lat, lng) ? { ...location, lat, lng } : null;
}

function cleanConcept3dName(value) {
  return String(value ?? "")
    .replace(/^Correct rendering of\s+/i, "")
    .replace(/\s*\|\s*[A-Z0-9 &]+\s*$/, "")
    .trim();
}

function formatLsmAddress(lines, buildingName) {
  const normalizedName = normalizeForComparison(buildingName);
  return lines
    .filter((line, index) => index > 0 || normalizeForComparison(line) !== normalizedName)
    .filter((line) => !/^(ON|Ontario)$/i.test(line))
    .map((line) => line.replace(/,\s*ON$/i, ""))
    .join(", ")
    .trim();
}

function htmlFragmentLines(fragment) {
  return fragment
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .split("\n")
    .map((line) => htmlToText(line))
    .filter(Boolean);
}

function htmlToText(value) {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body) => {
    if (body[0] === "#") {
      const hex = body[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return named[body.toLowerCase()] ?? entity;
  });
}

function normalizeNameTokens(value) {
  return normalizeForComparison(value)
    .split(" ")
    .map((token) => TOKEN_ALIASES.get(token) ?? token)
    .filter((token) => token && !NAME_STOP_WORDS.has(token));
}

function normalizeForComparison(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCacheKey(value) {
  return normalizeForComparison(value);
}

function mostFrequentId(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function isFiniteCoordinate(value) {
  return Number.isFinite(Number(value));
}

function isInTorontoBounds(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat > 43.6 && lat < 43.7 && lng > -79.42 && lng < -79.36;
}

function isInUtsgBounds(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= UTSG_BOUNDS.south &&
    lat <= UTSG_BOUNDS.north &&
    lng >= UTSG_BOUNDS.west &&
    lng <= UTSG_BOUNDS.east
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NAME_STOP_WORDS = new Set(["a", "an", "and", "at", "for", "of", "the"]);
const GENERIC_BUILDING_TOKENS = new Set([
  "building",
  "centre",
  "college",
  "faculty",
  "hall",
  "house",
  "school",
]);
const TOKEN_ALIASES = new Map([
  ["bdg", "building"],
  ["bldg", "building"],
  ["center", "centre"],
  ["labs", "laboratories"],
  ["lab", "laboratory"],
  ["tech", "technology"],
]);
