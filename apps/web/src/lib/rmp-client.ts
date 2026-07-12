/**
 * Client-side fetcher for the `/api/prof-rating` Rate My Professors lookup, with
 * a module-scoped in-memory cache so the same instructor is only fetched once per
 * session, plus in-flight promise dedup so concurrent renders of the same
 * instructor (e.g. many section rows) collapse into a single request.
 */

/** Aggregate RMP rating figures for a professor. */
export interface RmpRating {
  avgRating: number;
  avgDifficulty: number;
  /** Percentage who would take again, or `-1` when RMP has no data. */
  wouldTakeAgainPercent: number;
  numRatings: number;
  department: string;
  legacyId: number;
}

/** Result of an RMP lookup from `/api/prof-rating`. */
export interface RmpLookupResult {
  found: boolean;
  rating: RmpRating | null;
  rmpUrl: string | null;
  matchConfidence: "exact" | "high" | null;
}

const cache = new Map<string, RmpLookupResult>();
const pending = new Map<string, Promise<RmpLookupResult | null>>();

function cacheKey(firstName: string, lastName: string): string {
  return `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}`;
}

/**
 * Looks up the RMP rating for an instructor by name. Resolves to `null` on any
 * failure (400/502, network error, malformed body) so callers can simply render
 * nothing. Not-found responses are valid and are cached like any other result.
 * Passing an {@link AbortSignal} lets callers cancel in-flight fetches on unmount.
 */
export async function fetchProfRating(
  firstName: string,
  lastName: string,
  signal?: AbortSignal,
): Promise<RmpLookupResult | null> {
  const key = cacheKey(firstName, lastName);
  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  const inFlight = pending.get(key);

  if (inFlight) {
    return inFlight;
  }

  // Deliberately don't pass `signal` into the shared request: one caller
  // aborting must not cancel the lookup for other rows awaiting the same key.
  const request = (async (): Promise<RmpLookupResult | null> => {
    try {
      const response = await fetch(
        `/api/prof-rating?first=${encodeURIComponent(firstName)}&last=${encodeURIComponent(lastName)}`,
      );

      if (!response.ok) {
        return null;
      }

      const result = (await response.json()) as RmpLookupResult;

      cache.set(key, result);
      return result;
    } catch {
      return null;
    } finally {
      pending.delete(key);
    }
  })();

  pending.set(key, request);

  if (!signal) {
    return request;
  }

  // Honour the caller's signal without cancelling the shared request.
  return new Promise<RmpLookupResult | null>((resolve) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }

    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });

    request.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve(null);
      },
    );
  });
}
