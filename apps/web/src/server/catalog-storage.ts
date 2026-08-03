import type { Course, DivisionalEnrolmentIndicators } from "@better-ttb/shared";

export interface CatalogArtifact {
  sessions: string[];
  scrapedAt: string;
  total: number;
  courses: Course[];
  divisionalEnrolmentIndicators?: DivisionalEnrolmentIndicators;
}

export interface CatalogVersion {
  key: string;
  etag: string;
  scrapedAt: string;
  publishedAt: string;
  total: number;
  encoding: "gzip";
  compressedBytes: number;
  uncompressedBytes: number;
}

export interface CatalogManifest {
  version: 1;
  active: CatalogVersion;
  previous?: CatalogVersion;
}

export interface CatalogKeyValue {
  get(key: string): Promise<string | null>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  put(
    key: string,
    value: string | ArrayBuffer,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

interface LegacyCatalogMeta {
  etag: string;
  scrapedAt: string;
  total: number;
}

export function catalogKey(sessions: readonly string[]): string {
  return `catalog:${sessionKey(sessions)}`;
}

export function catalogMetaKey(sessions: readonly string[]): string {
  return `catalog:meta:${sessionKey(sessions)}`;
}

export function catalogManifestKey(sessions: readonly string[]): string {
  return `catalog:manifest:${sessionKey(sessions)}`;
}

export function catalogBlobKey(
  sessions: readonly string[],
  runId: number,
): string {
  return `catalog:blob:${sessionKey(sessions)}:${runId}`;
}

export function sessionKey(sessions: readonly string[]): string {
  return normalizeSessions(sessions).join(",");
}

export async function readCatalogManifest(
  kv: CatalogKeyValue,
  sessions: readonly string[],
): Promise<CatalogManifest | null> {
  return parseCatalogManifest(await kv.get(catalogManifestKey(sessions)));
}

export async function readCatalogSummary(
  kv: CatalogKeyValue,
  sessions: readonly string[],
): Promise<{ scrapedAt: string; total: number; etag: string } | null> {
  const manifest = await readCatalogManifest(kv, sessions);
  if (manifest) {
    return {
      scrapedAt: manifest.active.scrapedAt,
      total: manifest.active.total,
      etag: manifest.active.etag,
    };
  }
  const legacy = parseLegacyMeta(await kv.get(catalogMetaKey(sessions)));
  return legacy
    ? { scrapedAt: legacy.scrapedAt, total: legacy.total, etag: legacy.etag }
    : null;
}

export async function publishCatalog(
  kv: CatalogKeyValue,
  catalog: CatalogArtifact,
  runId: number,
  publishedAt: string,
): Promise<CatalogManifest> {
  const json = JSON.stringify(catalog);
  const compressed = await gzip(json);
  const previousManifest = await readCatalogManifest(kv, catalog.sessions);
  const active: CatalogVersion = {
    key: catalogBlobKey(catalog.sessions, runId),
    etag: `catalog-${runId}`,
    scrapedAt: catalog.scrapedAt,
    publishedAt,
    total: catalog.total,
    encoding: "gzip",
    compressedBytes: compressed.byteLength,
    uncompressedBytes: new TextEncoder().encode(json).byteLength,
  };
  const manifest: CatalogManifest = {
    version: 1,
    active,
    ...(previousManifest?.active ? { previous: previousManifest.active } : {}),
  };

  await kv.put(active.key, compressed);
  await kv.put(catalogManifestKey(catalog.sessions), JSON.stringify(manifest));

  const obsolete = previousManifest?.previous;
  if (obsolete && obsolete.key !== active.key && obsolete.key !== manifest.previous?.key) {
    await kv.delete(obsolete.key);
  }

  return manifest;
}

export async function getCatalogResponse(
  kv: CatalogKeyValue,
  sessions: readonly string[],
  request: Request,
): Promise<Response | null> {
  const manifest = await readCatalogManifest(kv, sessions);

  if (manifest) {
    const activeEtag = formatCatalogEtag(manifest.active.etag);
    const headers = catalogHeaders(activeEtag);

    if (matchesIfNoneMatch(request.headers.get("If-None-Match"), activeEtag)) {
      return new Response(null, { status: 304, headers });
    }

    const active = await readVersion(kv, manifest.active, request, headers);
    if (active) {
      return active;
    }

    if (manifest.previous) {
      const previousEtag = formatCatalogEtag(manifest.previous.etag);
      return await readVersion(
        kv,
        manifest.previous,
        request,
        catalogHeaders(previousEtag),
      );
    }
  }

  return await readLegacyCatalog(kv, sessions, request);
}

export function formatCatalogEtag(value: string): string {
  return `W/"${value.replaceAll('"', "")}"`;
}

export function matchesIfNoneMatch(value: string | null, etag: string): boolean {
  const expected = normalizeEtag(etag);
  return (
    value
      ?.split(",")
      .map((candidate) => candidate.trim())
      .some(
        (candidate) => candidate === "*" || normalizeEtag(candidate) === expected,
      ) ?? false
  );
}

function catalogHeaders(etag: string): Headers {
  return new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=0, must-revalidate",
    ETag: etag,
    Vary: "Accept-Encoding",
  });
}

async function readVersion(
  kv: CatalogKeyValue,
  version: CatalogVersion,
  request: Request,
  headers: Headers,
): Promise<Response | null> {
  const body = await kv.get(version.key, "arrayBuffer");
  if (!body) {
    return null;
  }

  if (request.headers.get("Accept-Encoding")?.includes("gzip")) {
    headers.set("Content-Encoding", "gzip");
    return new Response(body, { headers, encodeBody: "manual" });
  }

  return new Response(await gunzip(body), { headers });
}

async function readLegacyCatalog(
  kv: CatalogKeyValue,
  sessions: readonly string[],
  request: Request,
): Promise<Response | null> {
  const [catalog, rawMeta] = await Promise.all([
    kv.get(catalogKey(sessions)),
    kv.get(catalogMetaKey(sessions)),
  ]);
  if (!catalog) {
    return null;
  }

  const meta = parseLegacyMeta(rawMeta);
  const etag = meta ? formatCatalogEtag(meta.etag) : null;
  const headers = catalogHeaders(etag ?? "");
  if (!etag) {
    headers.delete("ETag");
  } else if (matchesIfNoneMatch(request.headers.get("If-None-Match"), etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(catalog, { headers });
}

function parseCatalogManifest(value: string | null): CatalogManifest | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1) {
      return null;
    }
    const active = parseCatalogVersion(parsed.active);
    const previous = parseCatalogVersion(parsed.previous);
    if (!active) {
      return null;
    }
    return {
      version: 1,
      active,
      ...(previous ? { previous } : {}),
    };
  } catch {
    return null;
  }
}

function parseCatalogVersion(value: unknown): CatalogVersion | null {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.etag !== "string" ||
    typeof value.scrapedAt !== "string" ||
    typeof value.publishedAt !== "string" ||
    typeof value.total !== "number" ||
    value.encoding !== "gzip" ||
    typeof value.compressedBytes !== "number" ||
    typeof value.uncompressedBytes !== "number"
  ) {
    return null;
  }
  return value as unknown as CatalogVersion;
}

function parseLegacyMeta(value: string | null): LegacyCatalogMeta | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.etag !== "string" ||
      typeof parsed.scrapedAt !== "string" ||
      typeof parsed.total !== "number"
    ) {
      return null;
    }
    return parsed as unknown as LegacyCatalogMeta;
  } catch {
    return null;
  }
}

function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

function normalizeSessions(sessions: readonly string[]): string[] {
  const normalized = sessions
    .map((session) => session.trim())
    .filter((session) => session.length > 0);
  if (normalized.length === 0) {
    throw new Error("At least one session is required");
  }
  return normalized;
}

async function gzip(value: string): Promise<ArrayBuffer> {
  const stream = new Blob([value])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

async function gunzip(value: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([value])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
