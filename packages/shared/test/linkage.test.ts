import { describe, expect, it } from "vitest";

import {
  linkedSectionName,
  sectionAllowedByLinkage,
  selectionSatisfiesLinkage,
} from "../src";
import type { LinkedMeetingSection } from "../src";

// ---------------------------------------------------------------------------
// CSC207-shaped fixtures
//
// LECs have linkedMeetingSections: []
// TUTs have linkedMeetingSections: [{ teachMethod: "LEC", sectionNumber: "XXXX" }]
// TUT0501 is the odd one out: linkedMeetingSections: []
// ---------------------------------------------------------------------------

type SectionLike = {
  name: string;
  teachMethod: string;
  linkedMeetingSections: LinkedMeetingSection[] | null;
};

function lec(num: string): SectionLike {
  return { name: `LEC${num}`, teachMethod: "LEC", linkedMeetingSections: [] };
}

function tut(num: string, linkedLec: string): SectionLike {
  return {
    name: `TUT${num}`,
    teachMethod: "TUT",
    linkedMeetingSections: [{ teachMethod: "LEC", sectionNumber: linkedLec, type: null }],
  };
}

// TUT0501 links to no one (empty array, like an LEC)
const TUT0501: SectionLike = {
  name: "TUT0501",
  teachMethod: "TUT",
  linkedMeetingSections: [],
};

// Section with null linkage (course without linkage data)
function nullLinkage(name: string, teachMethod: string): SectionLike {
  return { name, teachMethod, linkedMeetingSections: null };
}

const LEC0101 = lec("0101");
const LEC0201 = lec("0201");
const LEC0301 = lec("0301");
const TUT0201 = tut("0201", "0101"); // links LEC0101
const TUT0302 = tut("0302", "0301"); // links LEC0301

// ---------------------------------------------------------------------------
// linkedSectionName
// ---------------------------------------------------------------------------

describe("linkedSectionName", () => {
  it("concatenates teachMethod and sectionNumber", () => {
    const ref: LinkedMeetingSection = { teachMethod: "LEC", sectionNumber: "0101", type: null };
    expect(linkedSectionName(ref)).toBe("LEC0101");
  });

  it("works with non-null type", () => {
    const ref: LinkedMeetingSection = { teachMethod: "TUT", sectionNumber: "0201", type: "some-type" };
    expect(linkedSectionName(ref)).toBe("TUT0201");
  });
});

// ---------------------------------------------------------------------------
// sectionAllowedByLinkage — no selection
// ---------------------------------------------------------------------------

describe("sectionAllowedByLinkage — no selection", () => {
  it("allows any LEC when nothing is selected", () => {
    expect(sectionAllowedByLinkage(LEC0101, [])).toBe(true);
    expect(sectionAllowedByLinkage(LEC0301, [])).toBe(true);
  });

  it("allows any TUT when nothing is selected", () => {
    expect(sectionAllowedByLinkage(TUT0201, [])).toBe(true);
    expect(sectionAllowedByLinkage(TUT0302, [])).toBe(true);
    expect(sectionAllowedByLinkage(TUT0501, [])).toBe(true);
  });

  it("allows null-linkage section when nothing is selected", () => {
    expect(sectionAllowedByLinkage(nullLinkage("LEC9999", "LEC"), [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sectionAllowedByLinkage — LEC0101 chosen, evaluating TUTs
// ---------------------------------------------------------------------------

describe("sectionAllowedByLinkage — LEC0101 selected", () => {
  const selected = [LEC0101];

  it("allows TUT0201 (links LEC0101)", () => {
    expect(sectionAllowedByLinkage(TUT0201, selected)).toBe(true);
  });

  it("disallows TUT0302 (links LEC0301, not LEC0101)", () => {
    expect(sectionAllowedByLinkage(TUT0302, selected)).toBe(false);
  });

  it("disallows TUT0501 (empty array — not pointed to by LEC0101)", () => {
    // LEC0101 has [] so o is empty; TUT0501 has [] so it needs o to contain its name
    expect(sectionAllowedByLinkage(TUT0501, selected)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sectionAllowedByLinkage — TUT0201 chosen (links LEC0101), evaluating LECs
// ---------------------------------------------------------------------------

describe("sectionAllowedByLinkage — TUT0201 selected", () => {
  const selected = [TUT0201];

  it("allows LEC0101 (TUT0201 links it, so it appears in o)", () => {
    // TUT0201.linkedMeetingSections = [LEC0101], so o = { LEC0101 }
    // LEC0101 has [] so its own links check: needs o.has("LEC0101") → true
    expect(sectionAllowedByLinkage(LEC0101, selected)).toBe(true);
  });

  it("disallows LEC0301 (not pointed to by TUT0201)", () => {
    expect(sectionAllowedByLinkage(LEC0301, selected)).toBe(false);
  });

  it("allows LEC0201 if it has null linkage", () => {
    const lec0201null = nullLinkage("LEC0201", "LEC");
    expect(sectionAllowedByLinkage(lec0201null, selected)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sectionAllowedByLinkage — null linkage
// ---------------------------------------------------------------------------

describe("sectionAllowedByLinkage — null linkage sections", () => {
  it("null-linkage candidate is always allowed regardless of selection", () => {
    const nullSec = nullLinkage("LEC9999", "LEC");
    expect(sectionAllowedByLinkage(nullSec, [TUT0201])).toBe(true);
    expect(sectionAllowedByLinkage(nullSec, [TUT0302])).toBe(true);
  });

  it("null-linkage in selectedOthers contributes nothing to o (no crash)", () => {
    const nullTut = nullLinkage("TUT9999", "TUT");
    // nullTut has null links, so o stays empty
    // LEC0101 has [] → needs o.has("LEC0101") → false
    expect(sectionAllowedByLinkage(LEC0101, [nullTut])).toBe(false);
    // null-linkage LEC → always true
    const nullLec = nullLinkage("LEC9999", "LEC");
    expect(sectionAllowedByLinkage(nullLec, [nullTut])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sectionAllowedByLinkage — dangling ref
// ---------------------------------------------------------------------------

describe("sectionAllowedByLinkage — dangling refs", () => {
  it("TUT with dangling ref (links non-existent LEC) is disallowed when a real LEC is chosen", () => {
    const tutDangling: SectionLike = {
      name: "TUT9999",
      teachMethod: "TUT",
      linkedMeetingSections: [{ teachMethod: "LEC", sectionNumber: "9999", type: null }],
    };
    // LEC0101 is selected; tutDangling links LEC9999 which doesn't match
    expect(sectionAllowedByLinkage(tutDangling, [LEC0101])).toBe(false);
  });

  it("no crash when dangling ref is in selectedOthers' links", () => {
    const tutDangling: SectionLike = {
      name: "TUT9999",
      teachMethod: "TUT",
      linkedMeetingSections: [{ teachMethod: "LEC", sectionNumber: "9999", type: null }],
    };
    // tutDangling is selected; evaluating LEC0101 (empty array)
    // o = { LEC9999 }; LEC0101.name = "LEC0101" not in o → disallowed
    expect(sectionAllowedByLinkage(LEC0101, [tutDangling])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sectionAllowedByLinkage — same-teachMethod filtering
// ---------------------------------------------------------------------------

describe("sectionAllowedByLinkage — same-teachMethod in selectedOthers is ignored", () => {
  it("ignores same-teachMethod entries, behaving as if selection is empty", () => {
    // Caller passes both a TUT and another LEC; the LEC should be ignored
    // Effective selection: [TUT0201] (LEC0201 has same teachMethod as LEC0101 candidate)
    const result = sectionAllowedByLinkage(LEC0101, [TUT0201, LEC0201]);
    // After filtering out LEC (same as LEC0101.teachMethod="LEC"), only TUT0201 remains.
    // o = { LEC0101 }; LEC0101 has [] → allowed iff o.has("LEC0101") → true
    expect(result).toBe(true);
  });

  it("all same-teachMethod: acts as empty selection, returns true", () => {
    expect(sectionAllowedByLinkage(TUT0302, [TUT0201, TUT0501])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// selectionSatisfiesLinkage
// ---------------------------------------------------------------------------

describe("selectionSatisfiesLinkage", () => {
  it("empty selection is trivially satisfied", () => {
    expect(selectionSatisfiesLinkage([])).toBe(true);
  });

  it("single section is always satisfied", () => {
    expect(selectionSatisfiesLinkage([LEC0101])).toBe(true);
    expect(selectionSatisfiesLinkage([TUT0201])).toBe(true);
    expect(selectionSatisfiesLinkage([TUT0501])).toBe(true);
  });

  it("valid pair: LEC0101 + TUT0201 (mutually linked)", () => {
    expect(selectionSatisfiesLinkage([LEC0101, TUT0201])).toBe(true);
  });

  it("invalid pair: LEC0101 + TUT0302 (TUT links wrong LEC)", () => {
    expect(selectionSatisfiesLinkage([LEC0101, TUT0302])).toBe(false);
  });

  it("invalid pair: LEC0101 + TUT0501 (TUT0501 has [], not pointed to by LEC)", () => {
    expect(selectionSatisfiesLinkage([LEC0101, TUT0501])).toBe(false);
  });

  it("valid pair: LEC0301 + TUT0302 (mutually consistent)", () => {
    expect(selectionSatisfiesLinkage([LEC0301, TUT0302])).toBe(true);
  });

  it("null-linkage combo: always satisfied", () => {
    const nullLec = nullLinkage("LEC0101", "LEC");
    const nullTut = nullLinkage("TUT0201", "TUT");
    expect(selectionSatisfiesLinkage([nullLec, nullTut])).toBe(true);
  });

  it("null-linkage paired with empty-array section", () => {
    // nullLec → always allowed from its own perspective
    // LEC0101 (empty array) → needs o.has("LEC0101"); nullTut has null links, contributes nothing → false
    const nullTut = nullLinkage("TUT0201", "TUT");
    expect(selectionSatisfiesLinkage([LEC0101, nullTut])).toBe(false);
  });

  it("three-way: LEC + matching TUT + null-linkage PRA", () => {
    const pra = nullLinkage("PRA0101", "PRA");
    expect(selectionSatisfiesLinkage([LEC0101, TUT0201, pra])).toBe(true);
  });

  it("three-way fails when TUT links wrong LEC", () => {
    const pra = nullLinkage("PRA0101", "PRA");
    expect(selectionSatisfiesLinkage([LEC0101, TUT0302, pra])).toBe(false);
  });
});
