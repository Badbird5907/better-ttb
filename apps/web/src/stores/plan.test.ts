import { describe, expect, it } from "vitest";

import {
  chooseSection,
  clearSectionChoice,
  createPlan,
  migratePlanStoreState,
  pinCourse,
  renamePlan,
  unpinCourse,
} from "./plan";

describe("plan reducers", () => {
  it("pins, chooses, clears, renames, and unpins courses", () => {
    const plan = createPlan("Draft", ["20269"]);
    const pinned = pinCourse(plan, "CSC108H1", "F");
    const chosen = chooseSection(pinned, "CSC108H1", "F", "LEC", "LEC0101");
    const cleared = clearSectionChoice(chosen, "CSC108H1", "F", "LEC");
    const renamed = renamePlan(cleared, "  Fall plan  ");
    const unpinned = unpinCourse(renamed, "CSC108H1", "F");

    expect(pinned.pinned).toHaveLength(1);
    expect(chosen.pinned[0]?.chosen.LEC).toBe("LEC0101");
    expect(cleared.pinned[0]?.chosen.LEC).toBeNull();
    expect(renamed.name).toBe("Fall plan");
    expect(unpinned.pinned).toHaveLength(0);
  });

  it("does not duplicate the same course offering", () => {
    const plan = createPlan("Draft", ["20269"]);
    const once = pinCourse(plan, "CSC108H1", "F");
    const twice = pinCourse(once, "CSC108H1", "F");

    expect(twice.pinned).toHaveLength(1);
  });

  it("migrates persisted plans with generator prefs while preserving unknown prefs", () => {
    const migrated = migratePlanStoreState(
      {
        plans: [
          {
            id: "plan-1",
            name: "Fall",
            sessions: ["20269"],
            pinned: [],
            prefs: {
              custom: "kept",
            },
          },
        ],
        activePlanId: "plan-1",
      },
      1,
    );

    expect(migrated.activePlanId).toBe("plan-1");
    expect(migrated.plans[0]?.prefs.custom).toBe("kept");
    expect(migrated.plans[0]?.prefs.generator?.version).toBe(1);
    expect(migrated.plans[0]?.prefs.generator?.rules.length).toBeGreaterThan(0);
  });
});
