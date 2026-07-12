import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { TimetableBlock } from "@/lib/timetable";
import { WeekGrid } from "./WeekGrid";

const block: TimetableBlock = {
  id: "CSC108H1:F:LEC:LEC0101:0",
  sectionKey: "CSC108H1:F:LEC:LEC0101",
  courseKey: "CSC108H1:F",
  courseCode: "CSC108H1",
  courseName: "Introduction to Computer Programming",
  teachMethod: "LEC",
  sectionName: "LEC0101",
  room: "BA 1130",
  day: 1,
  startMillis: 10 * 60 * 60 * 1000,
  endMillis: 11 * 60 * 60 * 1000,
  color: "#7c3aed",
  conflict: false,
  disallowed: false,
  preview: false,
};

describe("WeekGrid", () => {
  // Regression: DEFAULT_START/END were once computed from a const declared later
  // in the module (TDZ). The minified bundle yielded NaN instead of throwing,
  // which produced invalid CSS (grid-template-rows: NaNpx, top: NaN%) that the
  // browser silently dropped — collapsing the grid body to zero height.
  it("renders a finite grid body height and finite block offsets", () => {
    const html = renderToStaticMarkup(React.createElement(WeekGrid, { blocks: [block] }));

    const rows = html.match(/grid-template-rows:([^;"]+)/);
    expect(rows?.[1]).toMatch(/^\d+(\.\d+)?px$/);

    expect(html).not.toContain("NaN");
    expect(html).toContain("CSC108H1");

    const tops = [...html.matchAll(/top:([^;"]+)%/g)].map((m) => Number(m[1]));
    expect(tops.length).toBeGreaterThan(0);
    tops.forEach((top) => expect(Number.isFinite(top)).toBe(true));
  });

  it("renders an 8:00-22:00 skeleton when there are no blocks", () => {
    const html = renderToStaticMarkup(React.createElement(WeekGrid, { blocks: [] }));
    const rows = html.match(/grid-template-rows:([^;"]+)/);

    expect(rows?.[1]).toBe("784px"); // 14 hours x 56px
    expect(html).not.toContain("NaN");
  });

  it("renders a disallowed block with grey ring and grey borderColor", () => {
    const disallowedBlock: TimetableBlock = { ...block, disallowed: true };
    const html = renderToStaticMarkup(React.createElement(WeekGrid, { blocks: [disallowedBlock] }));

    // Grey ring class applied for disallowed-only blocks
    expect(html).toContain("ring-slate-500");
    // Grey borderColor via inline style
    expect(html).toContain("#64748b");
    // Red conflict classes must NOT appear
    expect(html).not.toContain("ring-red-600");
    expect(html).not.toContain("#dc2626");
  });

  it("renders conflict red when a block has both conflict and disallowed (conflict wins)", () => {
    const conflictAndDisallowedBlock: TimetableBlock = { ...block, conflict: true, disallowed: true };
    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, { blocks: [conflictAndDisallowedBlock] }),
    );

    // Red conflict classes must appear
    expect(html).toContain("ring-red-600");
    expect(html).toContain("#dc2626");
    // Grey ring must NOT appear (conflict wins)
    expect(html).not.toContain("ring-slate-500");
    expect(html).not.toContain("#64748b");
  });
});
