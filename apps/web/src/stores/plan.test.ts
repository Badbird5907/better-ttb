import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PLAN_STORAGE_VERSION,
  applyExternalPlanState,
  chooseSection,
  clearSectionChoice,
  createInitialPlanState,
  createPlan,
  migratePlanStoreState,
  pinCourse,
  renamePlan,
  unpinCourse,
  usePlanStore,
  type Plan,
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

describe("cross-tab sync", () => {
  const storageValue = (plans: Plan[], activePlanId: string): string =>
    JSON.stringify({
      state: { plans, activePlanId },
      version: PLAN_STORAGE_VERSION,
    });

  beforeEach(() => {
    usePlanStore.setState(createInitialPlanState());
  });

  it("applies plans written by another tab", () => {
    const foreignA = createPlan("Foreign A", ["20269"]);
    const foreignB = createPlan("Foreign B", ["20271"]);

    applyExternalPlanState(storageValue([foreignA, foreignB], foreignB.id));

    const state = usePlanStore.getState();
    expect(state.plans.map((plan) => plan.id)).toEqual([foreignA.id, foreignB.id]);
    // Local active plan no longer exists, so fall back to the incoming one.
    expect(state.activePlanId).toBe(foreignB.id);
  });

  it("keeps the local active plan when it still exists in incoming state", () => {
    const planA = createPlan("Plan A", ["20269"]);
    const planB = createPlan("Plan B", ["20271"]);
    usePlanStore.setState({ plans: [planA, planB], activePlanId: planA.id });

    const renamed = { ...planB, name: "Plan B renamed" };
    applyExternalPlanState(storageValue([planA, renamed], planB.id));

    const state = usePlanStore.getState();
    expect(state.activePlanId).toBe(planA.id);
    expect(state.plans[1]?.name).toBe("Plan B renamed");
  });

  it("ignores malformed, null, and implausible values", () => {
    const before = usePlanStore.getState();

    applyExternalPlanState(null);
    applyExternalPlanState("not json");
    applyExternalPlanState(JSON.stringify({ state: { plans: [] } }));
    applyExternalPlanState(JSON.stringify({ nonsense: true }));

    expect(usePlanStore.getState()).toBe(before);
  });

  it("does not update state when incoming plans are identical", () => {
    const before = usePlanStore.getState();

    applyExternalPlanState(storageValue(before.plans, before.activePlanId));

    // Reference equality proves setState was skipped (no echo write).
    expect(usePlanStore.getState()).toBe(before);
  });
});

describe("plan store actions", () => {
  beforeEach(() => {
    usePlanStore.setState(createInitialPlanState("plan-1"));
  });

  it("routes null selections through clearSectionChoice in chooseMany", () => {
    const state = usePlanStore.getState();

    state.chooseMany([
      {
        courseCode: "CSC207H1",
        sectionCode: "F",
        teachMethod: "LEC",
        sectionName: "LEC0101",
      },
      {
        courseCode: "CSC207H1",
        sectionCode: "F",
        teachMethod: "TUT",
        sectionName: "TUT0101",
      },
      {
        courseCode: "CSC207H1",
        sectionCode: "F",
        teachMethod: "TUT",
        sectionName: null,
      },
    ]);

    const pinned = usePlanStore.getState().plans[0]?.pinned[0];

    expect(pinned?.chosen.LEC).toBe("LEC0101");
    expect(pinned?.chosen.TUT).toBeNull();
  });
});

describe("cross-tab echo suppression", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not write back to localStorage when applying another tab's state", async () => {
    const written: string[] = [];
    const backing = new Map<string, string>();

    vi.resetModules();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => {
          written.push(key);
          backing.set(key, value);
        },
        removeItem: (key: string) => void backing.delete(key),
      },
    });

    // Fresh module instance so the persist middleware binds to the stub.
    const plan = await import("./plan");
    const foreign = plan.createPlan("Foreign", ["20269"]);

    plan.applyExternalPlanState(
      JSON.stringify({
        state: { plans: [foreign], activePlanId: foreign.id },
        version: plan.PLAN_STORAGE_VERSION,
      }),
    );

    // State was applied, but nothing was echoed back into localStorage.
    expect(plan.usePlanStore.getState().plans[0]?.id).toBe(foreign.id);
    expect(written).toHaveLength(0);

    // Ordinary local actions still persist.
    plan.usePlanStore.getState().newPlan();
    expect(written).toContain(plan.PLAN_STORAGE_KEY);
  });
});
