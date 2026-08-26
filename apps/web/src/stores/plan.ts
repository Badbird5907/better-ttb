import { DEFAULT_RULES, type RuleConfig } from "@better-ttb/generator";
import type { SectionCode, TeachMethod } from "@better-ttb/shared";
import { FALL_2026, WINTER_2027, YEAR } from "@better-ttb/shared";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const PLAN_STORAGE_KEY = "better-ttb:plans:v1";
export const PLAN_STORAGE_VERSION = 2;
export const DEFAULT_PLAN_SESSIONS = [FALL_2026, WINTER_2027, YEAR];
const INITIAL_PLAN_ID = "initial-plan";

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

export interface SectionSelection {
  courseCode: string;
  sectionCode: SectionCode;
  teachMethod: TeachMethod;
  sectionName: string | null;
}

/** Undo/redo stacks of `plan.pinned` snapshots for a single plan. */
export interface PlanHistory {
  past: PinnedCourse[][];
  future: PinnedCourse[][];
}

interface PlanHistoryState {
  /**
   * Selection history keyed by plan id. Deliberately outside `partialize`:
   * undo is a within-session affordance, and persisting stacks would let a
   * stale snapshot from a previous visit overwrite the current plan.
   */
  history: Record<string, PlanHistory>;
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
  /** Applies many section choices in one store update (one localStorage write). */
  chooseMany: (selections: readonly SectionSelection[]) => void;
  clearChoice: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
  ) => void;
  resetAllChoices: () => void;
  /** Restores the active plan's previous selections. Returns false when the undo stack is empty. */
  undo: () => boolean;
  /** Re-applies the selections a matching undo took back. Returns false when the redo stack is empty. */
  redo: () => boolean;
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

export type PlanStore = PersistedPlanState & PlanHistoryState & PlanActions;

/** How many selection changes per plan stay undoable. */
const HISTORY_LIMIT = 50;

// When true, persist writes are skipped. Set while applying state that came
// from another tab's localStorage write: re-persisting an externally-sourced
// update would fire storage events in every other tab, and with 2+ tabs those
// echoes replay each other's (possibly stale) snapshots in a write loop.
let suppressPersistWrite = false;

const planStorage = createJSONStorage(() => {
  // Accessing window throws during SSR; createJSONStorage catches it and
  // disables persistence, matching zustand's default localStorage behavior.
  const storage = window.localStorage;

  return {
    getItem: (name: string) => storage.getItem(name),
    setItem: (name: string, value: string) => {
      if (!suppressPersistWrite) {
        storage.setItem(name, value);
      }
    },
    removeItem: (name: string) => storage.removeItem(name),
  };
});

export const usePlanStore = create<PlanStore>()(
  persist(
    (set, get) => ({
      ...createInitialPlanState(INITIAL_PLAN_ID),
      history: {},
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
        set((state) =>
          recordSelectionChange(state, (plan) =>
            pinCourse(plan, courseCode, sectionCode),
          ),
        ),
      unpin: (courseCode, sectionCode) =>
        set((state) =>
          recordSelectionChange(state, (plan) =>
            unpinCourse(plan, courseCode, sectionCode),
          ),
        ),
      choose: (courseCode, sectionCode, teachMethod, sectionName) =>
        set((state) =>
          recordSelectionChange(state, (plan) =>
            chooseSection(plan, courseCode, sectionCode, teachMethod, sectionName),
          ),
        ),
      chooseMany: (selections) =>
        set((state) =>
          recordSelectionChange(state, (plan) =>
            selections.reduce(
              (updated, selection) =>
                selection.sectionName === null
                  ? clearSectionChoice(
                      updated,
                      selection.courseCode,
                      selection.sectionCode,
                      selection.teachMethod,
                    )
                  : chooseSection(
                      updated,
                      selection.courseCode,
                      selection.sectionCode,
                      selection.teachMethod,
                      selection.sectionName,
                    ),
              plan,
            ),
          ),
        ),
      clearChoice: (courseCode, sectionCode, teachMethod) =>
        set((state) =>
          recordSelectionChange(state, (plan) =>
            clearSectionChoice(plan, courseCode, sectionCode, teachMethod),
          ),
        ),
      resetAllChoices: () =>
        set((state) => recordSelectionChange(state, resetPlanChoices)),
      undo: () => {
        const stepped = stepPlanHistory(get(), "undo");

        if (!stepped) {
          return false;
        }

        set(stepped);
        return true;
      },
      redo: () => {
        const stepped = stepPlanHistory(get(), "redo");

        if (!stepped) {
          return false;
        }

        set(stepped);
        return true;
      },
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
        set((state) => {
          const next = deletePlanFromState(state, planId);

          // Deleting the last remaining plan is refused, and that plan keeps
          // its history.
          return next.plans.some((plan) => plan.id === planId)
            ? next
            : { ...next, history: withoutPlanHistory(state.history, planId) };
        }),
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
      storage: planStorage,
      partialize: (state) => ({
        plans: state.plans,
        activePlanId: state.activePlanId,
      }),
      migrate: (persisted, version) => migratePlanStoreState(persisted, version),
    },
  ),
);

/** Whether the active plan has a selection change to step back to. */
export function selectCanUndo(state: PlanStore): boolean {
  return (state.history[state.activePlanId]?.past.length ?? 0) > 0;
}

/** Whether the active plan has an undone selection change to re-apply. */
export function selectCanRedo(state: PlanStore): boolean {
  return (state.history[state.activePlanId]?.future.length ?? 0) > 0;
}

/**
 * Applies a plan-store localStorage value written by another tab. Plan
 * contents sync across tabs, but the active plan stays per-tab so users can
 * compare plans side-by-side; the local selection is only replaced when its
 * plan no longer exists in the incoming state.
 */
export function applyExternalPlanState(rawValue: string | null): void {
  if (rawValue === null) {
    return;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return;
  }

  // Ignore values without a plausible persisted shape rather than letting the
  // migrate fallback replace the user's plans with a fresh initial state.
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.state) ||
    !Array.isArray(parsed.state.plans) ||
    parsed.state.plans.length === 0
  ) {
    return;
  }

  const incoming = migratePlanStoreState(parsed.state, PLAN_STORAGE_VERSION);
  const current = usePlanStore.getState();
  const activePlanId = incoming.plans.some(
    (plan) => plan.id === current.activePlanId,
  )
    ? current.activePlanId
    : incoming.activePlanId;

  // No-op guard: skip identical updates to avoid pointless re-renders.
  if (
    activePlanId === current.activePlanId &&
    JSON.stringify(incoming.plans) === JSON.stringify(current.plans)
  ) {
    return;
  }

  // Suppress the persist write for this update: the data is already in
  // localStorage (another tab just wrote it), and re-writing it would fire
  // storage events in every other tab, causing tabs to fight over the key.
  suppressPersistWrite = true;
  try {
    // Drop undo history: it holds snapshots of plans this tab last saw, so
    // undoing after another tab's edit would silently discard that edit.
    usePlanStore.setState({ plans: incoming.plans, activePlanId, history: {} });
  } finally {
    suppressPersistWrite = false;
  }
}

/**
 * Keeps the plan store in sync with writes from other tabs. The storage event
 * only fires in tabs that did not perform the write. Returns an unsubscribe
 * function.
 */
export function subscribeToPlanStorageSync(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PLAN_STORAGE_KEY) {
      return;
    }

    // Read the key fresh instead of trusting event.newValue: during a burst of
    // writes, queued events carry stale snapshots, and applying one would roll
    // this tab back to older state.
    applyExternalPlanState(window.localStorage.getItem(PLAN_STORAGE_KEY));
  };

  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function createInitialPlanState(planId?: string): PersistedPlanState {
  const plan = createPlan("Plan 1", DEFAULT_PLAN_SESSIONS, planId);

  return {
    plans: [plan],
    activePlanId: plan.id,
  };
}

export function createPlan(
  name: string,
  sessions = DEFAULT_PLAN_SESSIONS,
  id = createId(),
): Plan {
  return {
    id,
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

export function resetPlanChoices(plan: Plan): Plan {
  if (plan.pinned.every((pinned) => Object.keys(pinned.chosen).length === 0)) {
    return plan;
  }

  return {
    ...plan,
    pinned: plan.pinned.map((pinned) => ({ ...pinned, chosen: {} })),
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

/**
 * Applies a selection change to the active plan and pushes the selections it
 * replaced onto that plan's undo stack. Changes that leave `pinned` identical
 * (re-choosing the section that is already selected, pinning a pinned course)
 * are dropped entirely, so undo never walks through steps that do nothing.
 */
function recordSelectionChange(
  state: PlanStore,
  updater: (plan: Plan) => Plan,
): Partial<PlanStore> {
  const plan = state.plans.find((entry) => entry.id === state.activePlanId);

  if (!plan) {
    return {};
  }

  const updated = updater(plan);

  if (samePinned(plan.pinned, updated.pinned)) {
    return {};
  }

  return {
    plans: state.plans.map((entry) => (entry === plan ? updated : entry)),
    history: pushPlanHistory(state.history, plan.id, plan.pinned),
  };
}

function pushPlanHistory(
  history: Record<string, PlanHistory>,
  planId: string,
  pinned: PinnedCourse[],
): Record<string, PlanHistory> {
  const past = [...(history[planId]?.past ?? []), pinned].slice(-HISTORY_LIMIT);

  // A fresh change makes the redo stack unreachable, as in any other editor.
  return { ...history, [planId]: { past, future: [] } };
}

function withoutPlanHistory(
  history: Record<string, PlanHistory>,
  planId: string,
): Record<string, PlanHistory> {
  const remaining = { ...history };

  delete remaining[planId];
  return remaining;
}

/**
 * Moves the active plan one step along its undo/redo stacks. Returns null when
 * that stack is empty so callers can tell "nothing to undo" from a real step.
 */
function stepPlanHistory(
  state: PlanStore,
  direction: "undo" | "redo",
): Partial<PlanStore> | null {
  const planId = state.activePlanId;
  const entry = state.history[planId];
  const plan = state.plans.find((candidate) => candidate.id === planId);

  if (!entry || !plan) {
    return null;
  }

  const source = direction === "undo" ? entry.past : entry.future;
  const restored = source.at(-1);

  if (!restored) {
    return null;
  }

  const trimmed = source.slice(0, -1);
  const grown = [
    ...(direction === "undo" ? entry.future : entry.past),
    plan.pinned,
  ];

  return {
    plans: state.plans.map((candidate) =>
      candidate === plan ? { ...plan, pinned: restored } : candidate,
    ),
    history: {
      ...state.history,
      [planId]:
        direction === "undo"
          ? { past: trimmed, future: grown }
          : { past: grown, future: trimmed },
    },
  };
}

function samePinned(
  left: readonly PinnedCourse[],
  right: readonly PinnedCourse[],
): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
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
