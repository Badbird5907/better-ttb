import type { CandidateTimetable } from "@better-ttb/generator";

import { daysOnCampusCount, totalWalkMinutes } from "@/lib/timetable";

export type ScoreTone = "good" | "warn" | "muted";

/**
 * Score buckets used to color the candidate score badge. Thresholds are shared
 * so the badge and any future summaries stay consistent.
 */
export function scoreTone(score: number): ScoreTone {
  if (score >= 80) {
    return "good";
  }

  if (score >= 60) {
    return "warn";
  }

  return "muted";
}

/**
 * Worst (largest) gap in minutes reported by any max-gap metric. Detail strings
 * look like `2 gaps > 60min (worst 95min)`; we parse the `worst NNNmin` token.
 * Returns 0 when no gap information is present.
 */
export function worstGapMinutes(candidate: CandidateTimetable): number {
  let worst = 0;

  for (const metric of candidate.metrics) {
    const match = /worst (\d+)min/.exec(metric.detail);

    if (match) {
      worst = Math.max(worst, Number(match[1]));
    }
  }

  return worst;
}

/**
 * Count of waitlisted sections reported by an avoid-waitlist metric. Detail
 * strings look like `3 waitlisted sections`. Returns 0 when the rule is absent.
 */
export function waitlistedCount(candidate: CandidateTimetable): number {
  for (const metric of candidate.metrics) {
    const match = /^(\d+) waitlisted/.exec(metric.detail);

    if (match) {
      return Number(match[1]);
    }
  }

  return 0;
}

export interface CandidateChip {
  key: "walk" | "campus" | "gap" | "waitlist";
  value: number;
  label: string;
}

/**
 * The (max 4) compact chips shown on each candidate card. Kept as pure data so
 * the presentation layer only maps icons + values.
 */
export function candidateChips(candidate: CandidateTimetable): CandidateChip[] {
  return [
    {
      key: "walk",
      value: Math.round(totalWalkMinutes(candidate)),
      label: "walk min",
    },
    {
      key: "campus",
      value: daysOnCampusCount(candidate),
      label: "campus days",
    },
    {
      key: "gap",
      value: worstGapMinutes(candidate),
      label: "worst gap min",
    },
    {
      key: "waitlist",
      value: waitlistedCount(candidate),
      label: "waitlisted",
    },
  ];
}
