import * as React from "react";

import { useCatalogForSessions } from "@/lib/use-catalog";
import { cn } from "@/lib/utils";
import { useCompletedCoursesStore } from "@/stores/completed-courses";
import { activePlanFromState, usePlanStore } from "@/stores/plan";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CompletedCoursesBulkImport } from "./bulk-import";
import { CompletedCoursesList } from "./list";
import { CompletedCoursesSearch } from "./search-add";
import { formatCredits, totalCredits } from "./utils";

const CONFIRM_CLEAR_TIMEOUT_MS = 4000;

/**
 * Self-contained completed-courses editor: type-to-add search, bulk transcript
 * paste, and a grouped list with optional grades. Embeddable anywhere (header
 * dialog, degree page); it loads the catalog for the active plan on its own and
 * degrades to manual code entry when the catalog isn't available.
 */
export function CompletedCoursesManager({
  className,
}: {
  className?: string | undefined;
}) {
  const plans = usePlanStore((state) => state.plans);
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const activePlan = React.useMemo(
    () => activePlanFromState({ plans, activePlanId }),
    [activePlanId, plans],
  );

  // Course names/search need a catalog; mirror the routes and load the active
  // plan's sessions. Loads are de-duped in the catalog store.
  useCatalogForSessions(activePlan.sessions);

  const courses = useCompletedCoursesStore((state) => state.courses);
  const clearAll = useCompletedCoursesStore((state) => state.clearAll);

  // Completed courses are persisted to localStorage, so the server render has
  // none of them; hold the list back until after hydration.
  const [mounted, setMounted] = React.useState(false);
  const [confirmingClear, setConfirmingClear] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!confirmingClear) {
      return;
    }

    const timeout = window.setTimeout(
      () => setConfirmingClear(false),
      CONFIRM_CLEAR_TIMEOUT_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [confirmingClear]);

  const codes = React.useMemo(() => Object.keys(courses), [courses]);
  const credits = React.useMemo(() => totalCredits(codes), [codes]);
  const courseCount = mounted ? codes.length : 0;

  function handleClearAll() {
    clearAll();
    setConfirmingClear(false);
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <CompletedCoursesSearch />
      <CompletedCoursesBulkImport />

      <Separator />

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium">
            {courseCount} {courseCount === 1 ? "course" : "courses"}
          </span>
          <span className="text-muted-foreground">
            {" · "}
            {formatCredits(mounted ? credits : 0)} credits
          </span>
        </p>
        {courseCount > 0 &&
          (confirmingClear ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Remove all?</span>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                onClick={handleClearAll}
              >
                Yes, clear
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setConfirmingClear(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmingClear(true)}
            >
              Clear all
            </Button>
          ))}
      </div>

      {mounted ? (
        <CompletedCoursesList />
      ) : (
        <div className="h-24 rounded-md border border-dashed" />
      )}
    </div>
  );
}
