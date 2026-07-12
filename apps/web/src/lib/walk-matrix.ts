import { walkSecondsKey, type WalkSecondsMap } from "@better-ttb/shared";

import matrixData from "@/data/walk-matrix.json";

/**
 * Vendored OSRM foot-profile walking matrix between all UTSG buildings. Real
 * pedestrian durations in seconds; `-1` marks an unroutable pair.
 *
 * Source and attribution live in {@link WalkMatrix.source}. This module is
 * web-only so the JSON never bundles into `@better-ttb/generator`.
 */
export interface WalkMatrix {
  version: number;
  generatedAt: string;
  source: string;
  codes: string[];
  seconds: number[][];
}

export const WALK_MATRIX = matrixData as WalkMatrix;

/**
 * Builds a `(fromCode, toCode) => seconds | null` lookup over a walk matrix.
 * Returns `null` when either code is unknown or the pair is unroutable (`-1`);
 * same building resolves to `0`. Codes are matched case-insensitively.
 */
export function walkSecondsLookup(
  matrix: WalkMatrix,
): (fromCode: string, toCode: string) => number | null {
  const index = new Map<string, number>();
  matrix.codes.forEach((code, i) => index.set(code.trim().toUpperCase(), i));

  return (fromCode, toCode) => {
    if (!fromCode || !toCode) {
      return null;
    }

    const from = fromCode.trim().toUpperCase();
    const to = toCode.trim().toUpperCase();

    if (from === to) {
      return 0;
    }

    const i = index.get(from);
    const j = index.get(to);

    if (i === undefined || j === undefined) {
      return null;
    }

    const seconds = matrix.seconds[i]?.[j];
    return typeof seconds === "number" && seconds >= 0 ? seconds : null;
  };
}

/** Shared lookup over the vendored matrix. */
export const lookupWalkSeconds = walkSecondsLookup(WALK_MATRIX);

/**
 * Flattens the matrix into a {@link WalkSecondsMap} of `"FROM|TO" -> seconds`,
 * restricted to the given building codes (both endpoints must be in the set).
 * Keeps the generator worker message small by only including relevant pairs.
 */
export function buildWalkSecondsMap(codes: Iterable<string>): WalkSecondsMap {
  const wanted = [...new Set([...codes].map((code) => code.trim().toUpperCase()))].filter(Boolean);
  const map: WalkSecondsMap = {};

  for (const from of wanted) {
    for (const to of wanted) {
      if (from === to) {
        continue;
      }

      const seconds = lookupWalkSeconds(from, to);
      if (seconds !== null) {
        map[walkSecondsKey(from, to)] = seconds;
      }
    }
  }

  return map;
}
