import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const DEGREE_PLAN_STORAGE_KEY = "better-ttb:degree-plan:v1";
export const DEGREE_PLAN_STORAGE_VERSION = 1;

interface PersistedDegreePlanState {
  /** Program ids, in the order they were added. */
  selectedPrograms: string[];
  /**
   * Program id -> clause keys (`programClauseKey(section, clause)`) the student
   * has ticked off by hand. Arrays rather than Sets so the state serialises;
   * call sites convert to a `Set` for `evaluateProgram`.
   */
  manualOverrides: Record<string, string[]>;
}

interface DegreePlanActions {
  addProgram: (id: string) => void;
  /** Removes the program but keeps its overrides, so re-adding restores them. */
  removeProgram: (id: string) => void;
  toggleOverride: (programId: string, clauseKey: string) => void;
  clearOverrides: (programId: string) => void;
}

export type DegreePlanStore = PersistedDegreePlanState & DegreePlanActions;

const degreePlanStorage = createJSONStorage(() => {
  // Accessing window throws during SSR; createJSONStorage catches it and
  // disables persistence, matching zustand's default localStorage behavior.
  const storage = window.localStorage;

  return {
    getItem: (name: string) => storage.getItem(name),
    setItem: (name: string, value: string) => storage.setItem(name, value),
    removeItem: (name: string) => storage.removeItem(name),
  };
});

export const useDegreePlanStore = create<DegreePlanStore>()(
  persist(
    (set) => ({
      selectedPrograms: [],
      manualOverrides: {},
      addProgram: (id) =>
        set((state) => {
          const trimmed = id.trim();

          if (trimmed.length === 0 || state.selectedPrograms.includes(trimmed)) {
            return {};
          }

          return { selectedPrograms: [...state.selectedPrograms, trimmed] };
        }),
      removeProgram: (id) =>
        set((state) => {
          if (!state.selectedPrograms.includes(id)) {
            return {};
          }

          return {
            selectedPrograms: state.selectedPrograms.filter(
              (current) => current !== id,
            ),
          };
        }),
      toggleOverride: (programId, clauseKey) =>
        set((state) => {
          const current = state.manualOverrides[programId] ?? [];
          const next = current.includes(clauseKey)
            ? current.filter((key) => key !== clauseKey)
            : [...current, clauseKey];

          if (next.length === 0) {
            const manualOverrides = { ...state.manualOverrides };
            delete manualOverrides[programId];

            return { manualOverrides };
          }

          return {
            manualOverrides: { ...state.manualOverrides, [programId]: next },
          };
        }),
      clearOverrides: (programId) =>
        set((state) => {
          if (state.manualOverrides[programId] === undefined) {
            return {};
          }

          const manualOverrides = { ...state.manualOverrides };
          delete manualOverrides[programId];

          return { manualOverrides };
        }),
    }),
    {
      name: DEGREE_PLAN_STORAGE_KEY,
      version: DEGREE_PLAN_STORAGE_VERSION,
      storage: degreePlanStorage,
      partialize: (state) => ({
        selectedPrograms: state.selectedPrograms,
        manualOverrides: state.manualOverrides,
      }),
      migrate: (persisted) => migrateDegreePlanState(persisted),
    },
  ),
);

export function migrateDegreePlanState(
  persisted: unknown,
): PersistedDegreePlanState {
  if (!isRecord(persisted)) {
    return { selectedPrograms: [], manualOverrides: {} };
  }

  const selectedPrograms = Array.isArray(persisted.selectedPrograms)
    ? dedupeStrings(persisted.selectedPrograms)
    : [];

  const manualOverrides: Record<string, string[]> = {};

  if (isRecord(persisted.manualOverrides)) {
    Object.entries(persisted.manualOverrides).forEach(([programId, keys]) => {
      if (!Array.isArray(keys)) {
        return;
      }

      const clauseKeys = dedupeStrings(keys);

      if (clauseKeys.length > 0) {
        manualOverrides[programId] = clauseKeys;
      }
    });
  }

  return { selectedPrograms, manualOverrides };
}

function dedupeStrings(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    if (typeof value !== "string" || value.length === 0 || seen.has(value)) {
      return;
    }

    seen.add(value);
    result.push(value);
  });

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stable empty array so `manualOverrides[id] ?? EMPTY` keeps a stable identity. */
export const NO_OVERRIDES: readonly string[] = [];
