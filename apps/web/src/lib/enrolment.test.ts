import type { DivisionalEnrolmentIndicators, EnrolmentControl } from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import {
  enrolmentControlLineItems,
  enrolmentIndicatorDescription,
} from "./enrolment";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function control(overrides: Partial<EnrolmentControl> = {}): EnrolmentControl {
  return {
    quantity: 100,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// enrolmentControlLineItems
// ---------------------------------------------------------------------------

describe("enrolmentControlLineItems", () => {
  it("returns empty array for empty controls", () => {
    expect(enrolmentControlLineItems([])).toEqual([]);
  });

  it("skips controls where post.code is EXCEPTIONS", () => {
    const result = enrolmentControlLineItems([
      control({ post: { code: "EXCEPTIONS", name: "Exceptions" } }),
    ]);
    expect(result).toEqual([]);
  });

  it("uses 'No students' when quantity is 0", () => {
    const result = enrolmentControlLineItems([control({ quantity: 0 })]);
    expect(result).toEqual(["No students"]);
  });

  it("uses 'No students' when quantity is missing (not set)", () => {
    // Omit quantity entirely — exactOptionalPropertyTypes forbids explicit undefined
    const c: EnrolmentControl = {};
    expect(enrolmentControlLineItems([c])).toEqual(["No students"]);
  });

  it("uses 'All students' when quantity is non-zero", () => {
    const result = enrolmentControlLineItems([control({ quantity: 1 })]);
    expect(result).toEqual(["All students"]);
  });

  it("skips wildcard org unit codes", () => {
    const result = enrolmentControlLineItems([
      control({ primaryOrg: { code: "*", name: "Faculty of Arts and Science" } }),
    ]);
    expect(result).toEqual(["All students"]);
  });

  it("skips empty org unit codes (blank string)", () => {
    const result = enrolmentControlLineItems([
      control({ primaryOrg: { code: "", name: "Some Faculty" } }),
    ]);
    expect(result).toEqual(["All students"]);
  });

  it("skips org units with blank names", () => {
    const result = enrolmentControlLineItems([
      control({ primaryOrg: { code: "ARTSC", name: "   " } }),
    ]);
    expect(result).toEqual(["All students"]);
  });

  it("appends 'in the {name}' for valid primaryOrg", () => {
    const result = enrolmentControlLineItems([
      control({ primaryOrg: { code: "ARTSC", name: "Faculty of Arts and Science" } }),
    ]);
    expect(result).toEqual(["All students in the Faculty of Arts and Science"]);
  });

  it("appends year of study when present and not wildcard", () => {
    const result = enrolmentControlLineItems([
      control({ yearOfStudy: "2" }),
    ]);
    expect(result).toEqual(["All students in year of study 2"]);
  });

  it("skips wildcard year of study (*)", () => {
    const result = enrolmentControlLineItems([
      control({ yearOfStudy: "*" }),
    ]);
    expect(result).toEqual(["All students"]);
  });

  it("appends subject with 'in {name}' (no 'the')", () => {
    const result = enrolmentControlLineItems([
      control({ subject: { code: "CSC", name: "Computer Science" } }),
    ]);
    expect(result).toEqual(["All students in Computer Science"]);
  });

  it("skips subject with wildcard code", () => {
    const result = enrolmentControlLineItems([
      control({ subject: { code: "*", name: "Computer Science" } }),
    ]);
    expect(result).toEqual(["All students"]);
  });

  it("pluralizes designation name with trailing 's'", () => {
    const result = enrolmentControlLineItems([
      control({ designation: { code: "VIC", name: "Victoria College Student" } }),
    ]);
    expect(result).toEqual(["All students Victoria College Students"]);
  });

  it("skips designation with wildcard code", () => {
    const result = enrolmentControlLineItems([
      control({ designation: { code: "*", name: "Something" } }),
    ]);
    expect(result).toEqual(["All students"]);
  });

  it("CSC207-shaped control — full line with faculty and department", () => {
    const result = enrolmentControlLineItems([
      control({
        quantity: 100,
        primaryOrg: { code: "ARTSC", name: "Faculty of Arts and Science" },
        post: { code: "ASSPE1689", name: "Department of Computer Science" },
      }),
    ]);
    expect(result).toEqual([
      "All students in the Faculty of Arts and Science in the Department of Computer Science",
    ]);
  });

  it("deduplicates identical line items preserving order", () => {
    const c = control({
      primaryOrg: { code: "ARTSC", name: "Faculty of Arts and Science" },
    });
    const result = enrolmentControlLineItems([c, c, c]);
    expect(result).toEqual(["All students in the Faculty of Arts and Science"]);
  });

  it("preserves order while deduplicating mixed items", () => {
    const c1 = control({
      primaryOrg: { code: "ARTSC", name: "Faculty of Arts and Science" },
    });
    const c2 = control({
      quantity: 50,
      subject: { code: "MAT", name: "Mathematics" },
    });
    const result = enrolmentControlLineItems([c1, c2, c1]);
    expect(result).toEqual([
      "All students in the Faculty of Arts and Science",
      "All students in Mathematics",
    ]);
  });

  it("processes org units in order: primaryOrg, associatedOrg, secondOrg, adminOrg, post, subjectPost", () => {
    const result = enrolmentControlLineItems([
      control({
        primaryOrg: { code: "ARTSC", name: "Arts and Science" },
        associatedOrg: { code: "ASSOC", name: "Associated Org" },
        post: { code: "POST1", name: "Post Program" },
      }),
    ]);
    expect(result).toEqual([
      "All students in the Arts and Science in the Associated Org in the Post Program",
    ]);
  });

  it("combines yearOfStudy with org unit", () => {
    const result = enrolmentControlLineItems([
      control({
        yearOfStudy: "3",
        primaryOrg: { code: "ARTSC", name: "Faculty of Arts and Science" },
      }),
    ]);
    expect(result).toEqual([
      "All students in year of study 3 in the Faculty of Arts and Science",
    ]);
  });
});

// ---------------------------------------------------------------------------
// enrolmentIndicatorDescription
// ---------------------------------------------------------------------------

describe("enrolmentIndicatorDescription", () => {
  const indicators: DivisionalEnrolmentIndicators = {
    ARTSC: [
      {
        code: "P",
        name: "Priority enrolment is given to certain students until July 22.",
      },
      {
        code: "E",
        name: "Enrolment in this course is restricted.",
      },
      {
        code: " P* ",  // code with whitespace — trim should handle
        name: "Priority star description",
      },
    ],
  };

  it("returns description for a matching code", () => {
    const result = enrolmentIndicatorDescription(indicators, "ARTSC", "P");
    expect(result).toBe("Priority enrolment is given to certain students until July 22.");
  });

  it("returns null for empty enrolmentInd", () => {
    const result = enrolmentIndicatorDescription(indicators, "ARTSC", "");
    expect(result).toBeNull();
  });

  it("returns null when division code is not in indicators", () => {
    const result = enrolmentIndicatorDescription(indicators, "ENGSC", "P");
    expect(result).toBeNull();
  });

  it("returns null when code is not found in the division", () => {
    const result = enrolmentIndicatorDescription(indicators, "ARTSC", "R1");
    expect(result).toBeNull();
  });

  it("trims the indicator code for comparison", () => {
    // code stored as " P* " should match search for "P*"
    const result = enrolmentIndicatorDescription(indicators, "ARTSC", "P*");
    expect(result).toBe("Priority star description");
  });

  it("trims the enrolmentInd for comparison", () => {
    // searching with leading/trailing space should still match
    const result = enrolmentIndicatorDescription(indicators, "ARTSC", " P ");
    expect(result).toBe("Priority enrolment is given to certain students until July 22.");
  });

  it("returns null when indicators is empty object", () => {
    const result = enrolmentIndicatorDescription({}, "ARTSC", "P");
    expect(result).toBeNull();
  });

  it("returns description for E code", () => {
    const result = enrolmentIndicatorDescription(indicators, "ARTSC", "E");
    expect(result).toBe("Enrolment in this course is restricted.");
  });
});
