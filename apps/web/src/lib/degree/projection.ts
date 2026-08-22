import type { ProgramProgress } from "@better-ttb/shared";

/**
 * Projected degree progress: "where would I be if the courses in my current
 * timetable all worked out?".
 *
 * The projection is a second `evaluateProgram` run over a widened weight map
 * rather than an estimate — pinned courses have to satisfy the same clauses in
 * the same greedy order, so a pinned course that no clause can use adds nothing.
 */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Widens a completed-courses weight map with the in-progress codes it does not
 * already contain.
 *
 * The input must already be a *credit weight* map (see
 * `creditWeightsFromCompleted`) — never the completed-courses store's raw
 * grades. Added codes map to `null`, which tells `evaluateProgram` to use the
 * weight implied by the course code. Completed entries are never overwritten,
 * so a course that is both completed and pinned stays completed.
 */
export function unionCreditWeights(
  completedWeights: Readonly<Record<string, number | null>>,
  inProgressCodes: readonly string[],
): Record<string, number | null> {
  const union: Record<string, number | null> = { ...completedWeights };

  for (const code of inProgressCodes) {
    if (!Object.prototype.hasOwnProperty.call(union, code)) {
      union[code] = null;
    }
  }

  return union;
}

/** Codes that are in progress and not already completed. */
export function pendingInProgressCodes(
  completedWeights: Readonly<Record<string, number | null>>,
  inProgressCodes: readonly string[],
): string[] {
  return inProgressCodes.filter(
    (code) => !Object.prototype.hasOwnProperty.call(completedWeights, code),
  );
}

export interface ProgramProjection {
  /** Credits already earned (completed courses only). */
  earnedCredits: number;
  /** Extra credits the in-progress courses would contribute, never negative. */
  inProgressCredits: number;
  /** Completed-only percentage, clamped 0-100; null when the total is unknown. */
  percent: number | null;
  /** Completed + in-progress percentage, clamped; null when total is unknown. */
  projectedPercent: number | null;
}

/**
 * Folds a completed-only evaluation and a projected one into the numbers the
 * program card renders. Pass `projected === null` when there is nothing in
 * progress — the projection then collapses onto the completed figures.
 *
 * `evaluateProgram` already clamps `earnedCredits` to the program total, so a
 * program that is already complete reports a zero delta rather than overflowing.
 */
export function projectProgramProgress(
  progress: ProgramProgress,
  projected: ProgramProgress | null,
): ProgramProjection {
  if (projected === null) {
    return {
      earnedCredits: progress.earnedCredits,
      inProgressCredits: 0,
      percent: progress.percent,
      projectedPercent: progress.percent,
    };
  }

  return {
    earnedCredits: progress.earnedCredits,
    inProgressCredits: Math.max(
      0,
      round2(projected.earnedCredits - progress.earnedCredits),
    ),
    percent: progress.percent,
    projectedPercent: projected.percent,
  };
}
