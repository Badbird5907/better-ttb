import type { ProgramCatalog } from "@better-ttb/shared";
import * as React from "react";

/**
 * Client-side loader for the degree program catalogue.
 *
 * `programs.json` is ~5 MB, so it is served as a static asset from
 * `apps/web/public/` rather than bundled: importing it would drag a JSON-as-JS
 * chunk into both the client entry graph and the Cloudflare Worker bundle
 * (which has a compressed size limit). Fetching keeps it out of both and lets
 * the edge cache/ETag it like any other asset. The module cache plus the
 * in-flight promise mean several components mounting in the same tick share a
 * single fetch/parse.
 */

export type ProgramCatalogStatus = "loading" | "ready" | "error";

export interface ProgramCatalogState {
  status: ProgramCatalogStatus;
  catalog: ProgramCatalog | null;
  /** Present only when `status === "error"`. */
  error?: string | undefined;
}

let cachedCatalog: ProgramCatalog | null = null;
let inFlight: Promise<ProgramCatalog> | null = null;

/** Loads (and memoises) the program catalogue. Safe to call concurrently. */
export function loadProgramCatalog(): Promise<ProgramCatalog> {
  if (cachedCatalog !== null) {
    return Promise.resolve(cachedCatalog);
  }

  if (inFlight === null) {
    inFlight = fetch("/programs.json")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Program catalogue request failed (${response.status})`);
        }
        const catalog = (await response.json()) as ProgramCatalog | null;
        if (
          catalog === null ||
          typeof catalog !== "object" ||
          catalog.version !== 1 ||
          !Array.isArray(catalog.programs)
        ) {
          throw new Error("Program catalogue has an unexpected shape");
        }
        cachedCatalog = catalog;

        return catalog;
      })
      .catch((error: unknown) => {
        // Let a later mount retry rather than caching the failure forever.
        inFlight = null;
        throw error;
      });
  }

  return inFlight;
}

/** Test seam: drops the module-level cache. */
export function resetProgramCatalogCache(): void {
  cachedCatalog = null;
  inFlight = null;
}

const LOADING_STATE: ProgramCatalogState = { status: "loading", catalog: null };

/**
 * Subscribes to the program catalogue. Renders `loading` on the server and on
 * the first client paint, then flips to `ready` once the chunk resolves.
 */
export function useProgramCatalog(): ProgramCatalogState {
  const [state, setState] = React.useState<ProgramCatalogState>(LOADING_STATE);

  React.useEffect(() => {
    let active = true;

    loadProgramCatalog().then(
      (catalog) => {
        if (active) {
          setState({ status: "ready", catalog });
        }
      },
      (error: unknown) => {
        if (active) {
          setState({
            status: "error",
            catalog: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );

    return () => {
      active = false;
    };
  }, []);

  return state;
}
