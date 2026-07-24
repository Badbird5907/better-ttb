import * as React from "react";

import { useCatalogStore } from "@/stores/catalog";

const REVALIDATE_AFTER_MS = 15 * 60 * 1000;

export function useCatalogForSessions(sessions: readonly string[] | null): void {
  const loadCatalog = useCatalogStore((state) => state.loadCatalog);
  const sessionsKey = sessions?.join(",") ?? "";

  React.useEffect(() => {
    if (sessions && sessions.length > 0) {
      void loadCatalog([...sessions]);
    }
  }, [loadCatalog, sessions, sessionsKey]);

  React.useEffect(() => {
    if (!sessions || sessions.length === 0) {
      return;
    }

    const revalidateWhenVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      const lastCheckedAt = useCatalogStore.getState().lastCheckedAt;
      const lastCheckedMillis = lastCheckedAt ? Date.parse(lastCheckedAt) : 0;

      if (
        !Number.isFinite(lastCheckedMillis) ||
        Date.now() - lastCheckedMillis >= REVALIDATE_AFTER_MS
      ) {
        void loadCatalog([...sessions]);
      }
    };

    document.addEventListener("visibilitychange", revalidateWhenVisible);
    return () => document.removeEventListener("visibilitychange", revalidateWhenVisible);
  }, [loadCatalog, sessions, sessionsKey]);
}
