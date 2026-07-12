/** A professor's aggregate ratings as reported by RateMyProfessors. */
export interface RmpRating {
  /** Average overall rating, 0-5. */
  avgRating: number;
  /** Average difficulty, 0-5. */
  avgDifficulty: number;
  /** -1 when RMP has insufficient data. */
  wouldTakeAgainPercent: number;
  numRatings: number;
  department: string;
  legacyId: number;
}

/**
 * How strongly a TTB instructor name matches an RMP candidate. `low` matches
 * are discarded (treated as not-found) to avoid showing the wrong professor.
 */
export type RmpMatchConfidence = "exact" | "high" | "low";

export interface RmpLookupResult {
  found: boolean;
  rating: RmpRating | null;
  rmpUrl: string | null;
  matchConfidence: RmpMatchConfidence | null;
}
