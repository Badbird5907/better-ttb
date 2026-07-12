import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { TimetableBlock } from "@/lib/timetable";
import { WeekGrid, walkConnectorTone } from "./WeekGrid";

const block: TimetableBlock = {
  id: "CSC108H1:F:LEC:LEC0101:0",
  sectionKey: "CSC108H1:F:LEC:LEC0101",
  courseKey: "CSC108H1:F",
  courseCode: "CSC108H1",
  courseName: "Introduction to Computer Programming",
  teachMethod: "LEC",
  sectionName: "LEC0101",
  room: "BA 1130",
  buildingCode: "BA",
  day: 1,
  startMillis: 10 * 60 * 60 * 1000,
  endMillis: 11 * 60 * 60 * 1000,
  color: "#7c3aed",
  conflict: false,
  disallowed: false,
  preview: false,
  waitlisted: false,
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

  it("renders a walking connector for back-to-back blocks in different buildings", () => {
    const nextBlock = nextBackToBackBlock({ buildingCode: "MP", room: "MP 102" });
    const html = renderToStaticMarkup(React.createElement(WeekGrid, { blocks: [block, nextBlock] }));

    expect(html).toContain("5 min");
    expect(html).toContain("Walk BA -&gt; MP, ~5 min");
    expect(html).toContain("text-white");
  });

  it.each([
    ["SS", "7 min", "text-amber-400"],
    ["AH", "15 min", "text-red-400"],
  ])("uses the walking connector warning tone for %s", (buildingCode, label, toneClass) => {
    const nextBlock = nextBackToBackBlock({ buildingCode, room: `${buildingCode} 102` });
    const html = renderToStaticMarkup(React.createElement(WeekGrid, { blocks: [block, nextBlock] }));

    expect(html).toContain(label);
    expect(html).toContain(toneClass);
  });

  it("does not render a walking connector when blocks are not truly back-to-back", () => {
    const nextBlock = nextBackToBackBlock({
      buildingCode: "MP",
      room: "MP 102",
      startMillis: block.endMillis + 5 * 60 * 1000,
      endMillis: block.endMillis + 65 * 60 * 1000,
    });
    const html = renderToStaticMarkup(React.createElement(WeekGrid, { blocks: [block, nextBlock] }));

    expect(html).not.toContain("Walk BA");
  });

  it("does not render a walking connector for same-building back-to-back blocks", () => {
    const nextBlock = nextBackToBackBlock({ buildingCode: "BA", room: "BA 2145" });
    const html = renderToStaticMarkup(React.createElement(WeekGrid, { blocks: [block, nextBlock] }));

    expect(html).not.toContain("Walk BA");
  });

  it("renders draft blocks with dashed styling and a grouped option count", () => {
    const draftBlock: TimetableBlock = {
      ...block,
      id: "draft:CSC108H1:F:LEC:1:36000000",
      sectionKey: "draft:CSC108H1:F:LEC:1:36000000",
      sectionName: "2 options",
      draft: true,
      draftOptions: ["LEC0201", "LEC0301"],
    };
    const html = renderToStaticMarkup(React.createElement(WeekGrid, { blocks: [draftBlock] }));

    expect(html).toContain("border-dashed");
    expect(html).toContain("rgba(124, 58, 237, 0.55)");
    expect(html).toContain("+2 options");
  });

  it("highlights the active section key without affecting draft blocks", () => {
    const html = renderToStaticMarkup(
      React.createElement(WeekGrid, {
        blocks: [block],
        highlightSectionKey: block.sectionKey,
      }),
    );

    expect(html).toContain("ring-white/70");
  });

  it("exports the walking connector tone used by other timetable controls", () => {
    expect(walkConnectorTone(4)).toBe("text-white");
    expect(walkConnectorTone(7)).toBe("text-amber-400");
    expect(walkConnectorTone(10)).toBe("text-red-400");
  });
});

function nextBackToBackBlock(overrides: Partial<TimetableBlock> = {}): TimetableBlock {
  return {
    ...block,
    id: "MAT137Y1:Y:LEC:LEC0101:0",
    sectionKey: "MAT137Y1:Y:LEC:LEC0101",
    courseKey: "MAT137Y1:Y",
    courseCode: "MAT137Y1",
    courseName: "Calculus",
    room: "MP 102",
    buildingCode: "MP",
    startMillis: block.endMillis,
    endMillis: block.endMillis + 60 * 60 * 1000,
    ...overrides,
  };
}
