import { describe, expect, it } from "vitest";

import { isBearerTokenAuthorized } from "./admin-auth";

describe("admin authorization", () => {
  it("fails closed when the admin token is missing", async () => {
    const request = new Request("https://example.test/api/admin/scrape", {
      headers: { Authorization: "Bearer undefined" },
    });
    expect(await isBearerTokenAuthorized(request, undefined)).toBe(false);
    expect(await isBearerTokenAuthorized(request, "   ")).toBe(false);
  });

  it("accepts only the configured bearer token", async () => {
    const valid = new Request("https://example.test/api/admin/scrape", {
      headers: { Authorization: "Bearer secret" },
    });
    const invalid = new Request("https://example.test/api/admin/scrape", {
      headers: { Authorization: "Bearer other" },
    });
    expect(await isBearerTokenAuthorized(valid, "secret")).toBe(true);
    expect(await isBearerTokenAuthorized(invalid, "secret")).toBe(false);
  });
});
