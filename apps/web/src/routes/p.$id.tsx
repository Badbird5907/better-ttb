import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Course } from "@better-ttb/shared";
import { Import, Layers } from "lucide-react";
import * as React from "react";

import { AppNav, MobileNav } from "@/components/app-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { WeekGrid } from "@/components/timetable/WeekGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parsePlanImport } from "@/lib/plan-io";
import {
  buildTermBlocks,
  computeCreditTotals,
  courseKey,
  pinnedKey,
  selectedSectionsFromPlan,
} from "@/lib/timetable";
import { useCatalogStore } from "@/stores/catalog";
import { type Plan, usePlanStore } from "@/stores/plan";

export const Route = createFileRoute("/p/$id")({
  head: () => ({ meta: [{ title: "Shared plan · better-ttb" }] }),
  component: SharedPlanRoute,
});

function SharedPlanRoute() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const status = useCatalogStore((state) => state.status);
  const catalog = useCatalogStore((state) => state.catalog);
  const loadCatalog = useCatalogStore((state) => state.loadCatalog);
  const importPlan = usePlanStore((state) => state.importPlan);
  const [plan, setPlan] = React.useState<Plan | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function loadSharedPlan() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/share/${id}`);

        if (!response.ok) {
          throw new Error(response.status === 404 ? "Shared plan not found." : `Share fetch failed with HTTP ${response.status}`);
        }

        const parsed = parsePlanImport((await response.json()) as unknown);

        if (!parsed) {
          throw new Error("Shared plan has an unexpected shape.");
        }

        if (!cancelled) {
          setPlan(parsed);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
          setPlan(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSharedPlan();

    return () => {
      cancelled = true;
    };
  }, [id]);

  React.useEffect(() => {
    if (plan) {
      void loadCatalog(plan.sessions);
    }
  }, [loadCatalog, plan]);

  const coursesByKey = React.useMemo(() => {
    const map = new Map<string, Course>();

    catalog?.courses.forEach((course) => map.set(courseKey(course), course));
    return map;
  }, [catalog]);
  const selected = React.useMemo(
    () => (plan ? selectedSectionsFromPlan(plan, coursesByKey) : []),
    [coursesByKey, plan],
  );
  const fall = React.useMemo(() => buildTermBlocks(selected, "fall"), [selected]);
  const winter = React.useMemo(() => buildTermBlocks(selected, "winter"), [selected]);
  const credits = React.useMemo(
    () => (plan ? computeCreditTotals(plan, coursesByKey) : { fall: 0, winter: 0 }),
    [coursesByKey, plan],
  );

  function importSharedPlan() {
    if (!plan) {
      return;
    }

    importPlan(plan, `${plan.name} Import`);
    void navigate({ to: "/timetable" });
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Layers className="size-4" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">better-ttb</h1>
              <p className="truncate text-xs text-muted-foreground">Shared plan</p>
            </div>
          </div>
          <AppNav />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button type="button" onClick={importSharedPlan} disabled={!plan}>
            <Import />
            Import as new plan
          </Button>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 p-4 pb-16 md:pb-4">
        {loading && <p className="text-sm text-muted-foreground">Loading shared plan.</p>}
        {error && <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {plan && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{plan.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {plan.pinned.length} courses · {status === "loading" ? "loading catalog" : "read-only summary"}
                </p>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline">Fall {credits.fall.toFixed(1)} credits</Badge>
                <Badge variant="outline">Winter {credits.winter.toFixed(1)} credits</Badge>
              </div>
            </div>

            <section className="rounded-md border bg-background p-3">
              <h3 className="mb-3 text-sm font-medium">Courses</h3>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {plan.pinned.map((pinned) => {
                  const course = coursesByKey.get(pinnedKey(pinned));
                  const choices = Object.entries(pinned.chosen)
                    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
                    .map(([method, section]) => `${method} ${section}`);

                  return (
                    <div key={pinnedKey(pinned)} className="rounded-md border p-3">
                      <p className="text-sm font-medium">{pinned.courseCode}</p>
                      <p className="text-xs text-muted-foreground">
                        {course?.name ?? pinned.sectionCode}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {choices.length > 0 ? (
                          choices.map((choice) => (
                            <Badge key={choice} variant="secondary">
                              {choice}
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline">No chosen sections</Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-2">
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Fall</h3>
                <WeekGrid blocks={fall.blocks} />
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-medium">Winter</h3>
                <WeekGrid blocks={winter.blocks} />
              </section>
            </div>
          </>
        )}
      </section>

      <MobileNav />
    </main>
  );
}

