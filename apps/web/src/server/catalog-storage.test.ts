import type { Course } from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import { csc108Course } from "./__fixtures__/ttb-pageable-csc108";
import {
  type CatalogArtifact,
  type CatalogKeyValue,
  catalogKey,
  catalogMetaKey,
  getCatalogResponse,
  matchesIfNoneMatch,
  publishCatalog,
} from "./catalog-storage";

describe("catalog storage", () => {
  it("publishes gzip blobs and serves the decoded catalog", async () => {
    const kv = new MemoryKv();
    const catalog = makeCatalog("2026-07-10T12:00:00.000Z");
    const manifest = await publishCatalog(
      kv,
      catalog,
      7,
      "2026-07-10T12:01:00.000Z",
    );
    expect(manifest.active.compressedBytes).toBeLessThan(
      manifest.active.uncompressedBytes,
    );
    const response = await getCatalogResponse(
      kv,
      catalog.sessions,
      new Request("https://example.test/api/catalog"),
    );
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual(catalog);
  });

  it("matches both weak and strong conditional ETags", () => {
    expect(matchesIfNoneMatch('W/"catalog-7"', 'W/"catalog-7"')).toBe(true);
    expect(matchesIfNoneMatch('"catalog-7"', 'W/"catalog-7"')).toBe(true);
    expect(matchesIfNoneMatch('W/"other"', 'W/"catalog-7"')).toBe(false);
  });

  it("serves the compressed blob when the client accepts gzip", async () => {
    const kv = new MemoryKv();
    const catalog = makeCatalog("2026-07-10T12:00:00.000Z");
    const manifest = await publishCatalog(
      kv,
      catalog,
      8,
      "2026-07-10T12:01:00.000Z",
    );
    const response = await getCatalogResponse(
      kv,
      catalog.sessions,
      new Request("https://example.test/api/catalog", {
        headers: { "Accept-Encoding": "br, gzip" },
      }),
    );

    expect(response?.headers.get("Content-Encoding")).toBe("gzip");
    expect((await response?.arrayBuffer())?.byteLength).toBe(
      manifest.active.compressedBytes,
    );
  });

  it("tells Workers that stored gzip bytes are already encoded", async () => {
    const kv = new MemoryKv();
    const catalog = makeCatalog("2026-07-10T12:00:00.000Z");
    await publishCatalog(kv, catalog, 9, "2026-07-10T12:01:00.000Z");

    const NativeResponse = globalThis.Response;
    let capturedInit: ResponseInit | undefined;
    class CapturingResponse extends NativeResponse {
      constructor(body?: BodyInit | null, init?: ResponseInit) {
        super(body, init);
        capturedInit = init;
      }
    }
    globalThis.Response = CapturingResponse;

    try {
      await getCatalogResponse(
        kv,
        catalog.sessions,
        new Request("https://example.test/api/catalog", {
          headers: { "Accept-Encoding": "gzip" },
        }),
      );
    } finally {
      globalThis.Response = NativeResponse;
    }

    expect(capturedInit?.encodeBody).toBe("manual");
  });

  it("falls back to the previous version when the active blob is unavailable", async () => {
    const kv = new MemoryKv();
    const first = makeCatalog("2026-07-10T12:00:00.000Z");
    await publishCatalog(kv, first, 1, "2026-07-10T12:01:00.000Z");
    const second = makeCatalog("2026-07-11T12:00:00.000Z");
    const manifest = await publishCatalog(
      kv,
      second,
      2,
      "2026-07-11T12:01:00.000Z",
    );
    kv.binary.delete(manifest.active.key);
    const response = await getCatalogResponse(
      kv,
      first.sessions,
      new Request("https://example.test/api/catalog"),
    );
    const body = (await response?.json()) as { scrapedAt: string };
    expect(body.scrapedAt).toBe(first.scrapedAt);
  });

  it("serves the legacy artifact during rollout", async () => {
    const kv = new MemoryKv();
    const catalog = makeCatalog("2026-07-10T12:00:00.000Z");
    kv.text.set(catalogKey(catalog.sessions), JSON.stringify(catalog));
    kv.text.set(
      catalogMetaKey(catalog.sessions),
      JSON.stringify({ etag: "3", scrapedAt: catalog.scrapedAt, total: 1 }),
    );
    const response = await getCatalogResponse(
      kv,
      catalog.sessions,
      new Request("https://example.test/api/catalog", {
        headers: { "If-None-Match": 'W/"3"' },
      }),
    );
    expect(response?.status).toBe(304);
  });
});

function makeCatalog(scrapedAt: string): CatalogArtifact {
  return {
    sessions: ["20269"],
    scrapedAt,
    total: 1,
    courses: [structuredClone(csc108Course) as Course],
  };
}

class MemoryKv implements CatalogKeyValue {
  readonly text = new Map<string, string>();
  readonly binary = new Map<string, ArrayBuffer>();

  async get(key: string): Promise<string | null>;
  async get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  async get(key: string, type?: "arrayBuffer"): Promise<string | ArrayBuffer | null> {
    return type === "arrayBuffer"
      ? this.binary.get(key) ?? null
      : this.text.get(key) ?? null;
  }

  async put(key: string, value: string | ArrayBuffer): Promise<void> {
    if (typeof value === "string") this.text.set(key, value);
    else this.binary.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.text.delete(key);
    this.binary.delete(key);
  }
}
