/**
 * UofT lectures start 10 minutes after their listed start time (a listed
 * 13:00-14:00 class actually runs 13:10-14:00). The real window a student has to
 * walk between two back-to-back classes is therefore
 * `(next listed start + grace) - prev listed end`.
 *
 * This grace applies ONLY to walk-transfer feasibility. Gap-based rules
 * (e.g. max-gap) keep using listed times unchanged.
 */
export const UOFT_TRANSFER_GRACE_MINUTES = 10;

/**
 * Flat map of real pedestrian walking durations between buildings, keyed by
 * `"FROM|TO"` where `FROM`/`TO` are UTSG building codes. Values are whole
 * seconds. Only routable, known pairs are present; a missing key means "unknown"
 * and callers should fall back to their haversine estimate.
 *
 * Building codes are compared case-insensitively via {@link walkSecondsKey}.
 */
export type WalkSecondsMap = Record<string, number>;

/** Builds the canonical `"FROM|TO"` key used by {@link WalkSecondsMap}. */
export function walkSecondsKey(fromCode: string, toCode: string): string {
  return `${fromCode.trim().toUpperCase()}|${toCode.trim().toUpperCase()}`;
}

/**
 * Looks up the walking duration (seconds) between two building codes in a
 * {@link WalkSecondsMap}. Same building is always 0. Returns `null` when the
 * pair is unknown so callers can fall back to a haversine estimate.
 */
export function walkSecondsFromMap(
  map: WalkSecondsMap | undefined,
  fromCode: string,
  toCode: string,
): number | null {
  if (!fromCode || !toCode) {
    return null;
  }

  if (fromCode.trim().toUpperCase() === toCode.trim().toUpperCase()) {
    return 0;
  }

  if (!map) {
    return null;
  }

  const value = map[walkSecondsKey(fromCode, toCode)];
  return typeof value === "number" && value >= 0 ? value : null;
}
