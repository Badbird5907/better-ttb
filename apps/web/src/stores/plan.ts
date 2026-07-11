import { DEFAULT_RULES, type RuleConfig } from "@better-ttb/generator";
import type { SectionCode, TeachMethod } from "@better-ttb/shared";
import { FALL_2026, WINTER_2027, YEAR } from "@better-ttb/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const PLAN_STORAGE_KEY = "better-ttb:plans:v1";
export const PLAN_STORAGE_VERSION = 2;
export const DEFAULT_PLAN_SESSIONS = [FALL_2026, WINTER_2027, YEAR];

export type GeneratorSortKey = "score" | "walking" | "earliest-start" | "days-on-campus";

export interface GeneratorPrefs {
  version: 1;
  rules: RuleConfig[];
  sort: GeneratorSortKey;
}

export interface PlanPrefs extends Record<string, unknown> {
  generator?: GeneratorPrefs;
}

export interface PinnedCourse {
  courseCode: string;
  sectionCode: SectionCode;
  chosen: Record<TeachMethod, string | null>;
}

export interface Plan {
  id: string;
  name: string;
  sessions: string[];
  pinned: PinnedCourse[];
  prefs: PlanPrefs;
}

interface PersistedPlanState {
  plans: Plan[];
  activePlanId: string;
}

interface PlanActions {
  setActivePlan: (planId: string) => void;
  setPlanSessions: (sessions: string[]) => void;
  pin: (courseCode: string, sectionCode: SectionCode) => void;
  unpin: (courseCode: string, sectionCode: SectionCode) => void;
  choose: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
    sectionName: string,
  ) => void;
  clearChoice: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
  ) => void;
  renamePlan: (planId: string, name: string) => void;
  newPlan: (sessions?: string[]) => void;
  deletePlan: (planId: string) => void;
  duplicatePlan: (planId: string) => void;
  importPlan: (plan: Plan, name?: string) => string;
  updatePlanPrefs: (
    planId: string,
    updater: (prefs: PlanPrefs, plan: Plan) => PlanPrefs,
  ) => void;
}

export type PlanStore = PersistedPlanState & PlanActions;

export const usePlanStore = create<PlanStore>()(
  persist(
    (set, get) => ({
      ...createInitialPlanState(),
      setActivePlan: (planId) =>
        set((state) =>
          state.plans.some((plan) => plan.id === planId)
            ? { activePlanId: planId }
            : {},
        ),
      setPlanSessions: (sessions) =>
        set((state) => ({
          plans: updatePlan(state.plans, state.activePlanId, (plan) => ({
            ...plan,
            sessions: normalizeSessions(sessions),
          })),
        })),
      pin: (courseCode, sectionCode) =>
        set((state) => ({
          plans: updatePlan(state.plans, state.activePlanId, (plan) =>
            pinCourse(plan, courseCode, sectionCode),
          ),
        })),
      unpin: (courseCode, sectionCode) =>
        set((state) => ({
          plans: updatePlan(state.plans, state.activePlanId, (plan) =>
            unpinCourse(plan, courseCode, sectionCode),
          ),
        })),
      choose: (courseCode, sectionCode, teachMethod, sectionName) =>
        set((state) => ({
          plans: updatePlan(state.plans, state.activePlanId, (plan) =>
            chooseSection(plan, courseCode, sectionCode, teachMethod, sectionName),
          ),
        })),
      clearChoice: (courseCode, sectionCode, teachMethod) =>
        set((state) => ({
          plans: updatePlan(state.plans, state.activePlanId, (plan) =>
            clearSectionChoice(plan, courseCode, sectionCode, teachMethod),
          ),
        })),
      renamePlan: (planId, name) =>
        set((state) => ({
          plans: updatePlan(state.plans, planId, (plan) => renamePlan(plan, name)),
        })),
      newPlan: (sessions) =>
        set((state) => {
          const plan = createPlan(nextPlanName(state.plans), sessions);

          return {
            plans: [...state.plans, plan],
            activePlanId: plan.id,
          };
        }),
      deletePlan: (planId) =>
        set((state) => deletePlanFromState(state, planId)),
      duplicatePlan: (planId) =>
        set((state) => duplicatePlanInState(state, planId)),
      importPlan: (plan, name) => {
        const imported = normalizeImportedPlan(plan, name);

        set((state) => ({
          plans: [...state.plans, imported],
          activePlanId: imported.id,
        }));

        return imported.id;
      },
      updatePlanPrefs: (planId, updater) =>
        set((state) => ({
          plans: updatePlan(state.plans, planId, (plan) => ({
            ...plan,
            prefs: updater(plan.prefs, plan),
          })),
        })),
    }),
    {
      name: PLAN_STORAGE_KEY,
      version: PLAN_STORAGE_VERSION,
      partialize: (state) => ({
        plans: state.plans,
        activePlanId: state.activePlanId,
      }),
      migrate: (persisted, version) => migratePlanStoreState(persisted, version),
    },
  ),
);

export function createInitialPlanState(): PersistedPlanState {
  const plan = createPlan("Plan 1", DEFAULT_PLAN_SESSIONS);

  return {
    plans: [plan],
    activePlanId: plan.id,
  };
}

export function createPlan(name: string, sessions = DEFAULT_PLAN_SESSIONS): Plan {
  return {
    id: createId(),
    name,
    sessions: normalizeSessions(sessions),
    pinned: [],
    prefs: createDefaultPlanPrefs(),
  };
}

export function createDefaultPlanPrefs(): PlanPrefs {
  return {
    generator: createDefaultGeneratorPrefs(),
  };
}

export function createDefaultGeneratorPrefs(): GeneratorPrefs {
  return {
    version: 1,
    rules: cloneRules(DEFAULT_RULES),
    sort: "score",
  };
}

export function pinCourse(
  plan: Plan,
  courseCode: string,
  sectionCode: SectionCode,
): Plan {
  if (findPinnedCourse(plan, courseCode, sectionCode)) {
    return plan;
  }

  return {
    ...plan,
    pinned: [
      ...plan.pinned,
      {
        courseCode,
        sectionCode,
        chosen: {},
      },
    ],
  };
}

export function unpinCourse(
  plan: Plan,
  courseCode: string,
  sectionCode: SectionCode,
): Plan {
  return {
    ...plan,
    pinned: plan.pinned.filter(
      (pinned) =>
        pinned.courseCode !== courseCode || pinned.sectionCode !== sectionCode,
    ),
  };
}

export function chooseSection(
  plan: Plan,
  courseCode: string,
  sectionCode: SectionCode,
  teachMethod: TeachMethod,
  sectionName: string,
): Plan {
  const pinnedPlan = pinCourse(plan, courseCode, sectionCode);

  return {
    ...pinnedPlan,
    pinned: pinnedPlan.pinned.map((pinned) =>
      pinned.courseCode === courseCode && pinned.sectionCode === sectionCode
        ? {
            ...pinned,
            chosen: {
              ...pinned.chosen,
              [teachMethod]: sectionName,
            },
          }
        : pinned,
    ),
  };
}

export function clearSectionChoice(
  plan: Plan,
  courseCode: string,
  sectionCode: SectionCode,
  teachMethod: TeachMethod,
): Plan {
  return {
    ...plan,
    pinned: plan.pinned.map((pinned) =>
      pinned.courseCode === courseCode && pinned.sectionCode === sectionCode
        ? {
            ...pinned,
            chosen: {
              ...pinned.chosen,
              [teachMethod]: null,
            },
          }
        : pinned,
    ),
  };
}

export function renamePlan(plan: Plan, name: string): Plan {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return plan;
  }

  return {
    ...plan,
    name: trimmed,
  };
}

export function activePlanFromState(state: PersistedPlanState): Plan {
  return state.plans.find((plan) => plan.id === state.activePlanId) ?? state.plans[0]!;
}

export function migratePlanStoreState(
  persisted: unknown,
  _version: number,
): PersistedPlanState {
  if (!isRecord(persisted)) {
    return createInitialPlanState();
  }

  const rawPlans = Array.isArray(persisted.plans) ? persisted.plans : [];
  const plans = rawPlans.map(normalizePlan).filter((plan): plan is Plan => Boolean(plan));

  if (plans.length === 0) {
    return createInitialPlanState();
  }

  const activePlanId =
    typeof persisted.activePlanId === "string" &&
    plans.some((plan) => plan.id === persisted.activePlanId)
      ? persisted.activePlanId
      : plans[0]!.id;

  return {
    plans,
    activePlanId,
  };
}

function updatePlan(
  plans: readonly Plan[],
  planId: string,
  updater: (plan: Plan) => Plan,
): Plan[] {
  return plans.map((plan) => (plan.id === planId ? updater(plan) : plan));
}

function deletePlanFromState(
  state: PersistedPlanState,
  planId: string,
): PersistedPlanState {
  if (state.plans.length <= 1) {
    return state;
  }

  const plans = state.plans.filter((plan) => plan.id !== planId);

  if (state.activePlanId !== planId) {
    return {
      ...state,
      plans,
    };
  }

  return {
    plans,
    activePlanId: plans[0]?.id ?? state.activePlanId,
  };
}

function duplicatePlanInState(
  state: PersistedPlanState,
  planId: string,
): PersistedPlanState {
  const source = state.plans.find((plan) => plan.id === planId);

  if (!source) {
    return state;
  }

  const duplicate: Plan = {
    ...structuredClone(source),
    id: createId(),
    name: `${source.name} Copy`,
  };

  return {
    plans: [...state.plans, duplicate],
    activePlanId: duplicate.id,
  };
}

function normalizeImportedPlan(plan: Plan, name: string | undefined): Plan {
  return {
    ...normalizePlan(plan)!,
    id: createId(),
    name: normalizePlanName(name ?? plan.name),
  };
}

function normalizePlan(value: unknown): Plan | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" && value.id ? value.id : createId();
  const name =
    typeof value.name === "string" && value.name.trim()
      ? normalizePlanName(value.name)
      : "Imported Plan";
  const sessions = Array.isArray(value.sessions)
    ? normalizeSessions(value.sessions.filter((session): session is string => typeof session === "string"))
    : DEFAULT_PLAN_SESSIONS;
  const pinned = Array.isArray(value.pinned)
    ? value.pinned.map(normalizePinnedCourse).filter((entry): entry is PinnedCourse => Boolean(entry))
    : [];
  const prefs = normalizePlanPrefs(value.prefs);

  return {
    id,
    name,
    sessions,
    pinned,
    prefs,
  };
}

function normalizePinnedCourse(value: unknown): PinnedCourse | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.courseCode !== "string" ||
    !isSectionCode(value.sectionCode) ||
    !isRecord(value.chosen)
  ) {
    return null;
  }

  const chosen: Record<TeachMethod, string | null> = {};

  Object.entries(value.chosen).forEach(([teachMethod, sectionName]) => {
    if (typeof sectionName === "string" || sectionName === null) {
      chosen[teachMethod] = sectionName;
    }
  });

  return {
    courseCode: value.courseCode,
    sectionCode: value.sectionCode,
    chosen,
  };
}

function normalizePlanPrefs(value: unknown): PlanPrefs {
  const base: PlanPrefs = isRecord(value) ? { ...value } : {};
  const generator = normalizeGeneratorPrefs(base.generator);

  return {
    ...base,
    generator,
  };
}

function normalizeGeneratorPrefs(value: unknown): GeneratorPrefs {
  if (!isRecord(value)) {
    return createDefaultGeneratorPrefs();
  }

  const rules = Array.isArray(value.rules)
    ? value.rules.filter(isRuleConfig)
    : createDefaultGeneratorPrefs().rules;
  const sort = isGeneratorSortKey(value.sort) ? value.sort : "score";

  // Old persisted prefs may carry a lockedCourseKeys field; it is intentionally
  // read-and-drop here so stale data doesn't leak into the current shape.
  return {
    version: 1,
    rules: rules.length > 0 ? cloneRules(rules) : createDefaultGeneratorPrefs().rules,
    sort,
  };
}

function cloneRules(rules: readonly RuleConfig[]): RuleConfig[] {
  return rules.map((rule) => ({ ...rule })) as RuleConfig[];
}

function isRuleConfig(value: unknown): value is RuleConfig {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    (value.mode === "hard" || value.mode === "soft") &&
    typeof value.weight === "number"
  );
}

function isGeneratorSortKey(value: unknown): value is GeneratorSortKey {
  return (
    value === "score" ||
    value === "walking" ||
    value === "earliest-start" ||
    value === "days-on-campus"
  );
}

function isSectionCode(value: unknown): value is SectionCode {
  return value === "F" || value === "S" || value === "Y";
}

function normalizePlanName(name: string): string {
  return name.trim() || "Imported Plan";
}

function findPinnedCourse(
  plan: Plan,
  courseCode: string,
  sectionCode: SectionCode,
): PinnedCourse | undefined {
  return plan.pinned.find(
    (pinned) =>
      pinned.courseCode === courseCode && pinned.sectionCode === sectionCode,
  );
}

function nextPlanName(plans: readonly Plan[]): string {
  const usedNames = new Set(plans.map((plan) => plan.name));
  let index = plans.length + 1;
  let name = `Plan ${index}`;

  while (usedNames.has(name)) {
    index += 1;
    name = `Plan ${index}`;
  }

  return name;
}

function normalizeSessions(sessions: readonly string[]): string[] {
  const normalized = sessions
    .map((session) => session.trim())
    .filter((session) => session.length > 0);

  return normalized.length > 0 ? normalized : DEFAULT_PLAN_SESSIONS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
