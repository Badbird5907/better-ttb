import type {
  RmpLookupResult,
  RmpMatchConfidence,
  RmpRating,
} from "@better-ttb/shared";

const RMP_ENDPOINT = "https://www.ratemyprofessors.com/graphql";
/** `Basic base64("test:test")` — the public credentials RMP's site uses. */
const RMP_AUTH = "Basic dGVzdDp0ZXN0";

/** UofT school GraphQL IDs, tried in order until a strong match is found. */
const SCHOOL_IDS = [
  "U2Nob29sLTE0ODQ=", // St. George
  "U2Nob29sLTE0ODU=", // UTM
  "U2Nob29sLTE0ODY=", // UTSC
] as const;

const CACHE_TTL_SECONDS = 604800; // 7 days.

const SEARCH_QUERY = `query SearchProf($text: String!, $schoolID: ID!) {
  newSearch {
    teachers(query: { text: $text, schoolID: $schoolID }, first: 5) {
      edges { node {
        legacyId firstName lastName department
        avgRating avgDifficulty wouldTakeAgainPercent numRatings
      } }
    }
  }
}`;

interface RmpTeacherNode {
  legacyId: number;
  firstName: string;
  lastName: string;
  department: string;
  avgRating: number;
  avgDifficulty: number;
  wouldTakeAgainPercent: number;
  numRatings: number;
}

interface RmpSearchResponse {
  data?: {
    newSearch?: {
      teachers?: {
        edges?: Array<{ node?: RmpTeacherNode }>;
      };
    };
  };
}

const NOT_FOUND: RmpLookupResult = {
  found: false,
  rating: null,
  rmpUrl: null,
  matchConfidence: null,
};

/**
 * Looks up a professor's RateMyProfessors rating by name, matching against the
 * UofT campuses. Results (hits and misses) are cached in KV for 7 days;
 * transient upstream failures are never cached.
 */
export async function lookupProfessorRating(
  kv: KVNamespace,
  firstName: string,
  lastName: string,
): Promise<RmpLookupResult> {
  const key = cacheKey(firstName, lastName);

  const cached = await kv.get(key);
  if (cached) {
    try {
      return JSON.parse(cached) as RmpLookupResult;
    } catch {
      // Fall through and re-fetch on corrupt cache entry.
    }
  }

  let best: ScoredMatch | null = null;

  for (const schoolID of SCHOOL_IDS) {
    let nodes: RmpTeacherNode[];
    try {
      nodes = await searchTeachers(`${firstName} ${lastName}`, schoolID);
    } catch {
      // Transient failure: return not-found without caching it.
      return NOT_FOUND;
    }

    for (const node of nodes) {
      const confidence = matchConfidence(firstName, lastName, node);
      if (!confidence) {
        continue;
      }

      const candidate: ScoredMatch = { node, confidence };
      if (isBetterMatch(candidate, best)) {
        best = candidate;
      }
    }

    // Stop once we have a strong match; only fall through to other campuses
    // when we've found nothing usable so far.
    if (best) {
      break;
    }
  }

  const result: RmpLookupResult = best ? toResult(best) : NOT_FOUND;

  await kv.put(key, JSON.stringify(result), { expirationTtl: CACHE_TTL_SECONDS });

  return result;
}

interface ScoredMatch {
  node: RmpTeacherNode;
  confidence: Exclude<RmpMatchConfidence, "low">;
}

function cacheKey(firstName: string, lastName: string): string {
  const normalized = `${firstName}_${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  return `rmp:v1:${normalized}`;
}

async function searchTeachers(
  text: string,
  schoolID: string,
): Promise<RmpTeacherNode[]> {
  const response = await fetch(RMP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: RMP_AUTH,
    },
    body: JSON.stringify({
      query: SEARCH_QUERY,
      variables: { text, schoolID },
    }),
  });

  if (!response.ok) {
    throw new Error(`RMP responded ${response.status}`);
  }

  const payload = (await response.json()) as RmpSearchResponse;
  const edges = payload.data?.newSearch?.teachers?.edges ?? [];

  return edges
    .map((edge) => edge.node)
    .filter((node): node is RmpTeacherNode => Boolean(node));
}

/**
 * Determines match confidence between a TTB instructor name and an RMP
 * candidate. Returns `null` for `low`/no match (case-insensitive throughout).
 */
function matchConfidence(
  ttbFirst: string,
  ttbLast: string,
  node: RmpTeacherNode,
): Exclude<RmpMatchConfidence, "low"> | null {
  const first = ttbFirst.trim().toLowerCase();
  const last = ttbLast.trim().toLowerCase();
  const rmpFirst = node.firstName.trim().toLowerCase();
  const rmpLast = node.lastName.trim().toLowerCase();

  if (!last || last !== rmpLast) {
    return null;
  }

  if (first && first === rmpFirst) {
    return "exact";
  }

  if (!first || !rmpFirst) {
    return null;
  }

  const ttbIsInitial = first.length === 1 && first[0] === rmpFirst[0];
  const rmpIsInitial = rmpFirst.length === 1 && rmpFirst[0] === first[0];
  const isPrefix = first.startsWith(rmpFirst) || rmpFirst.startsWith(first);

  if (ttbIsInitial || rmpIsInitial || isPrefix) {
    return "high";
  }

  return null;
}

/** Prefers exact over high; among equal confidence prefers more ratings. */
function isBetterMatch(candidate: ScoredMatch, current: ScoredMatch | null): boolean {
  if (!current) {
    return true;
  }

  const rank = (c: ScoredMatch): number => (c.confidence === "exact" ? 1 : 0);
  const candidateRank = rank(candidate);
  const currentRank = rank(current);

  if (candidateRank !== currentRank) {
    return candidateRank > currentRank;
  }

  return candidate.node.numRatings > current.node.numRatings;
}

function toResult(match: ScoredMatch): RmpLookupResult {
  const { node } = match;
  const rating: RmpRating = {
    avgRating: node.avgRating,
    avgDifficulty: node.avgDifficulty,
    wouldTakeAgainPercent: node.wouldTakeAgainPercent,
    numRatings: node.numRatings,
    department: node.department,
    legacyId: node.legacyId,
  };

  return {
    found: true,
    rating,
    rmpUrl: `https://www.ratemyprofessors.com/professor/${node.legacyId}`,
    matchConfidence: match.confidence,
  };
}
