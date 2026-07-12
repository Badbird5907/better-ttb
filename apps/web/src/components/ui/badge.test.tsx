import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Badge } from "./badge";

describe("Badge", () => {
  it("caps long labels to the available width and truncates them", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        "div",
        { className: "w-40" },
        React.createElement(
          Badge,
          { variant: "secondary" },
          "BR 5: The Physical and Mathematical Universes",
        ),
      ),
    );

    expect(html).toContain("max-w-full");
    expect(html).toContain("truncate");
  });
});
