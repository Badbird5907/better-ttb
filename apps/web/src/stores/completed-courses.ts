import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const COMPLETED_COURSES_STORAGE_KEY = "better-ttb:completed-courses:v1";
export const COMPLETED_COURSES_STORAGE_VERSION = 1;

const COURSE_CODE = /^[A-Z]{3,4}\d{2,3}[HY]\d$/;

export type CompletedCourseGrade = number | null;

interface PersistedCompletedCoursesState {
  courses: Record<string, CompletedCourseGrade>;
}

interface CompletedCoursesActions {
  setCourse: (code: string, grade: CompletedCourseGrade) => void;
  removeCourse: (code: string) => void;
  clearAll: () => void;
}

export type CompletedCoursesStore = PersistedCompletedCoursesState &
  CompletedCoursesActions;

const completedCoursesStorage = createJSONStorage(() => {
  // Accessing window throws during SSR; createJSONStorage catches it and
  // disables persistence, matching zustand's default localStorage behavior.
  const storage = window.localStorage;

  return {
    getItem: (name: string) => storage.getItem(name),
    setItem: (name: string, value: string) => storage.setItem(name, value),
    removeItem: (name: string) => storage.removeItem(name),
  };
});

export const useCompletedCoursesStore = create<CompletedCoursesStore>()(
  persist(
    (set) => ({
      courses: {},
      setCourse: (code, grade) =>
        set((state) => {
          const normalizedCode = normalizeCourseCode(code);

          if (!isValidCourseCode(normalizedCode)) {
            return {};
          }

          return {
            courses: {
              ...state.courses,
              [normalizedCode]: normalizeGrade(grade),
            },
          };
        }),
      removeCourse: (code) =>
        set((state) => {
          const normalizedCode = normalizeCourseCode(code);

          if (!(normalizedCode in state.courses)) {
            return {};
          }

          const courses = { ...state.courses };
          delete courses[normalizedCode];

          return { courses };
        }),
      clearAll: () => set({ courses: {} }),
    }),
    {
      name: COMPLETED_COURSES_STORAGE_KEY,
      version: COMPLETED_COURSES_STORAGE_VERSION,
      storage: completedCoursesStorage,
      partialize: (state) => ({ courses: state.courses }),
      migrate: (persisted) => migrateCompletedCoursesState(persisted),
    },
  ),
);

export function isValidCourseCode(code: string): boolean {
  return COURSE_CODE.test(normalizeCourseCode(code));
}

export function migrateCompletedCoursesState(
  persisted: unknown,
): PersistedCompletedCoursesState {
  if (!isRecord(persisted) || !isRecord(persisted.courses)) {
    return { courses: {} };
  }

  const courses: Record<string, CompletedCourseGrade> = {};

  Object.entries(persisted.courses).forEach(([code, grade]) => {
    const normalizedCode = normalizeCourseCode(code);

    if (!isValidCourseCode(normalizedCode)) {
      return;
    }

    if (grade === null) {
      courses[normalizedCode] = null;
    } else if (typeof grade === "number" && Number.isFinite(grade)) {
      courses[normalizedCode] = normalizeGrade(grade);
    }
  });

  return { courses };
}

function normalizeCourseCode(code: string): string {
  return code.trim().toUpperCase();
}

function normalizeGrade(grade: CompletedCourseGrade): CompletedCourseGrade {
  if (grade === null || !Number.isFinite(grade)) {
    return null;
  }

  return Math.min(100, Math.max(0, Math.round(grade)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
