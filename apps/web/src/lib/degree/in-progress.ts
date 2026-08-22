import * as React from "react";

import { activePlanFromState, usePlanStore, type Plan } from "@/stores/plan";

/**
 * "In progress" courses: whatever is pinned in the active timetable plan.
 *
 * The degree planner treats these as neither done nor missing — they are the
 * credits you are *currently* taking, so they colour chips differently and feed
 * the projected-progress segment on each program card. A course that is both
 * pinned and completed counts as completed; that precedence is applied at the
 * consumption sites rather than by filtering here, so this list stays a plain
 * reflection of the plan.
 *
 * Derivations are cached on the plan object's identity so every chip on the
 * page shares one array/set rather than rebuilding its own.
 */

export interface InProgressCourses {
  /** Uppercased, deduped, in pin order. */
  codes: readonly string[];
  set: ReadonlySet<string>;
}

const EMPTY: InProgressCourses = { codes: [], set: new Set<string>() };

const cache = new WeakMap<Plan, InProgressCourses>();

function inProgressForPlan(plan: Plan | null): InProgressCourses {
  if (plan === null) {
    return EMPTY;
  }

  const cached = cache.get(plan);

  if (cached !== undefined) {
    return cached;
  }

  const set = new Set<string>();
  const codes: string[] = [];

  for (const pinned of plan.pinned) {
    const code = pinned.courseCode.trim().toUpperCase();

    if (code.length === 0 || set.has(code)) {
      continue;
    }

    set.add(code);
    codes.push(code);
  }

  const value: InProgressCourses = codes.length === 0 ? EMPTY : { codes, set };
  cache.set(plan, value);

  return value;
}

/** Codes plus a membership set for the active plan's pinned courses. */
export function useInProgressCourses(): InProgressCourses {
  const plans = usePlanStore((state) => state.plans);
  const activePlanId = usePlanStore((state) => state.activePlanId);

  return React.useMemo(
    () =>
      inProgressForPlan(
        plans.length === 0 ? null : activePlanFromState({ plans, activePlanId }),
      ),
    [activePlanId, plans],
  );
}

/** Just the codes, for callers that iterate rather than test membership. */
export function useInProgressCourseCodes(): readonly string[] {
  return useInProgressCourses().codes;
}

/** Just the set, for callers that only ask "is this one in progress?". */
export function useInProgressCourseSet(): ReadonlySet<string> {
  return useInProgressCourses().set;
}
