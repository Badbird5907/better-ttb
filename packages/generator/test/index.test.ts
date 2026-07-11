import { describe, expect, it } from "vitest";

import { generate } from "../src";

describe("generate", () => {
  it("returns an empty placeholder result", () => {
    expect(generate({ courses: [], rules: [] })).toEqual([]);
  });
});
