import { describe, expect, it } from "vitest";

import { sanitizeHtml, stripHtml } from "./sanitize";

describe("sanitizeHtml", () => {
  it("keeps allowed markup and removes unsafe tags, attributes, and URLs", () => {
    const sanitized = sanitizeHtml(
      '<p onclick="alert(1)">Hi <strong>there</strong><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://example.com" onmouseover="x">ok</a></p>',
    );

    expect(sanitized).toContain("<p>");
    expect(sanitized).toContain("<strong>there</strong>");
    expect(sanitized).toContain("<a>bad</a>");
    expect(sanitized).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer">ok</a>',
    );
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("onmouseover");
    expect(sanitized).not.toContain("script");
    expect(sanitized).not.toContain("javascript:");
  });
});

describe("stripHtml", () => {
  it("removes tags and decodes common entities for indexing", () => {
    expect(stripHtml("<p>Intro&nbsp;<strong>Text</strong></p>")).toBe(
      "Intro Text",
    );
  });
});
