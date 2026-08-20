import { createFileRoute } from "@tanstack/react-router";
import type { DegreeProgram } from "@better-ttb/shared";
import { ListChecks, Plus, Sparkles } from "lucide-react";
import * as React from "react";

import { AppHeader } from "@/components/app-header";
import { MobileNav } from "@/components/app-nav";
import { CompletedCoursesManager } from "@/components/completed-courses/manager";
import { formatCredits as formatCompletedCredits, totalCredits } from "@/components/completed-courses/utils";
import { CoursePathView } from "@/components/degree/course-path-view";
import {
  ProgramCard,
  programCardDomId,
  useProgramProgress,
} from "@/components/degree/program-card";
import { ProgramPicker } from "@/components/degree/program-picker";
import { formatCredits } from "@/components/degree/program-meta";
import { useInProgressCourseCodes } from "@/lib/degree/in-progress";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import { buildProgramIndex } from "@/lib/degree/filter";
import { useProgramCatalog } from "@/lib/degree/use-programs";
import { useRequisiteGraph } from "@/lib/requisites/use-graph";
import { useCatalogForPlan } from "@/lib/use-catalog";
import { useCatalogStore } from "@/stores/catalog";
import { useCompletedCoursesStore } from "@/stores/completed-courses";
import { useDegreePlanStore } from "@/stores/degree";
import { activePlanFromState, usePlanStore } from "@/stores/plan";

export interface DegreeSearch {
  /** Deep link: adds (if needed), expands and scrolls to this program id. */
  program?: string;
}

export const Route = createFileRoute("/degree")({
  validateSearch: (search: Record<string, unknown>): DegreeSearch => {
    const program =
      typeof search.program === "string" ? search.program : undefined;

    return program ? { program } : {};
  },
  head: () => ({ meta: [{ title: "Degree Planner · better-ttb" }] }),
  component: DegreeRoute,
});

function DegreeRoute() {
  const search = Route.useSearch();

  const { status, catalog: programCatalog } = useProgramCatalog();

  // Course names, requisite chips and the path view all need the course
  // catalog; mirror the other routes and load the active plan's sessions.
  const plans = usePlanStore((state) => state.plans);
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const activePlan = React.useMemo(
    () => activePlanFromState({ plans, activePlanId }),
    [activePlanId, plans],
  );
  useCatalogForPlan(activePlan);

  const courseCatalog = useCatalogStore((state) => state.catalog);
  // The requisite graph is cached on the `courses` array identity, so pass the
  // catalog array straight through — never an inline `.filter()`.
  const graph = useRequisiteGraph(courseCatalog?.courses);

  const selectedIds = useDegreePlanStore((state) => state.selectedPrograms);
  const addProgram = useDegreePlanStore((state) => state.addProgram);

  const programIndex = React.useMemo(
    () =>
      programCatalog === null
        ? null
        : buildProgramIndex(programCatalog.programs),
    [programCatalog],
  );

  const programsById = React.useMemo(() => {
    const map = new Map<string, DegreeProgram>();

    programCatalog?.programs.forEach((program) => map.set(program.id, program));

    return map;
  }, [programCatalog]);

  const selectedPrograms = React.useMemo(
    () =>
      selectedIds.flatMap((id) => {
        const program = programsById.get(id);

        return program ? [program] : [];
      }),
    [programsById, selectedIds],
  );

  // Deep link: `?program=ASMAJ1689` adds the program and scrolls to its card.
  // Handled exactly once: the id is latched into state for the expand/scroll
  // behaviour and the search param is dropped, so removing the card and
  // reloading does not add the program straight back.
  const navigate = Route.useNavigate();
  const deepLinkParam = search.program ?? null;
  const [deepLinkId, setDeepLinkId] = React.useState<string | null>(
    deepLinkParam,
  );
  const deepLinkHandled = React.useRef(false);

  React.useEffect(() => {
    if (deepLinkParam === null || deepLinkHandled.current) {
      return;
    }

    // Wait for the catalog: an unknown id may just not have loaded yet.
    if (status === "loading") {
      return;
    }

    deepLinkHandled.current = true;

    const clearParam = () => void navigate({ search: {}, replace: true });

    if (!programsById.has(deepLinkParam)) {
      clearParam();
      return;
    }

    setDeepLinkId(deepLinkParam);
    addProgram(deepLinkParam);

    // Let the card mount before scrolling to it, and only drop the param
    // afterwards so clearing it cannot cancel this timeout.
    const timeout = window.setTimeout(() => {
      document
        .getElementById(programCardDomId(deepLinkParam))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      clearParam();
    }, 60);

    return () => window.clearTimeout(timeout);
  }, [addProgram, deepLinkParam, navigate, programsById, status]);

  const [focusCode, setFocusCode] = React.useState<string | null>(null);

  const openCourse = React.useCallback(
    (code: string) => setFocusCode(code),
    [],
  );

  const hasPrograms = selectedPrograms.length > 0;

  return (
    <TooltipProvider>
      <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <AppHeader brandIcon={ListChecks} />

        <div className="min-h-0 flex-1 overflow-y-auto pb-16 md:pb-0">
          <div className="mx-auto grid w-full max-w-6xl items-start gap-4 p-4 md:grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 space-y-3">
              {status === "loading" && !hasPrograms && <LoadingHero />}

              {status !== "loading" && !hasPrograms && (
                <EmptyHero
                  index={programIndex}
                  status={status}
                  selectedIds={selectedIds}
                  onAdd={addProgram}
                />
              )}

              {hasPrograms && (
                <>
                  <SummaryStrip
                    programs={selectedPrograms}
                    index={programIndex}
                    status={status}
                    selectedIds={selectedIds}
                    onAdd={addProgram}
                  />

                  {selectedPrograms.map((program, index) => (
                    <ProgramCard
                      key={program.id}
                      program={program}
                      defaultExpanded={index === 0 || program.id === deepLinkId}
                      graph={graph}
                      onOpenCourse={openCourse}
                    />
                  ))}
                </>
              )}

              {status === "ready" &&
                selectedIds.length > selectedPrograms.length && (
                  <p className="text-xs text-muted-foreground">
                    {selectedIds.length - selectedPrograms.length} saved program
                    {selectedIds.length - selectedPrograms.length === 1
                      ? " is"
                      : "s are"}{" "}
                    no longer in the calendar and can&apos;t be shown.
                  </p>
                )}
            </div>

            {/* Ordered after the requirements on mobile, sticky beside them on
                desktop — one instance either way, so no duplicated state. */}
            <aside className="min-w-0 md:sticky md:top-4">
              <div className="rounded-lg border bg-card p-3 text-card-foreground shadow-sm">
                <h2 className="text-sm font-semibold">Completed courses</h2>
                <p className="mt-0.5 mb-2 text-xs text-muted-foreground">
                  Everything you&apos;ve passed. Requirements tick themselves off
                  as you add courses.
                </p>
                <CompletedCoursesManager className="md:max-h-[calc(100dvh-14rem)] md:overflow-y-auto" />
              </div>
            </aside>
          </div>
        </div>

        <PathSheet
          code={focusCode}
          courses={courseCatalog?.courses ?? null}
          onOpenCourse={openCourse}
          onClose={() => setFocusCode(null)}
        />

        <MobileNav />
      </main>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

function LoadingHero(): React.ReactElement {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function EmptyHero({
  index,
  status,
  selectedIds,
  onAdd,
}: {
  index: React.ComponentProps<typeof ProgramPicker>["index"];
  status: React.ComponentProps<typeof ProgramPicker>["status"];
  selectedIds: readonly string[];
  onAdd: (programId: string) => void;
}): React.ReactElement {
  return (
    <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-muted-foreground" />
        <h1 className="text-base font-semibold">Plan your degree</h1>
      </div>
      <p className="mt-1 mb-3 max-w-prose text-sm text-muted-foreground">
        Add the specialists, majors, minors, focuses and certificates you&apos;re
        working towards. We check each requirement against your completed
        courses — and anything we can&apos;t verify, you can tick off yourself.
      </p>

      <ProgramPicker
        index={index}
        status={status}
        selectedIds={selectedIds}
        onAdd={onAdd}
        listClassName="max-h-80"
      />

      <p className="mt-3 text-xs text-muted-foreground">
        Already have a transcript? Paste it into{" "}
        <span className="font-medium text-foreground">Completed courses</span> to
        fill in your progress in one go.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function SummaryStrip({
  programs,
  index,
  status,
  selectedIds,
  onAdd,
}: {
  programs: readonly DegreeProgram[];
  index: React.ComponentProps<typeof ProgramPicker>["index"];
  status: React.ComponentProps<typeof ProgramPicker>["status"];
  selectedIds: readonly string[];
  onAdd: (programId: string) => void;
}): React.ReactElement {
  const completed = useCompletedCoursesStore((state) => state.courses);
  const inProgress = useInProgressCourseCodes();

  const codes = React.useMemo(() => Object.keys(completed), [completed]);
  const credits = React.useMemo(() => totalCredits(codes), [codes]);
  const inProgressCredits = React.useMemo(
    () => totalCredits(inProgress.filter((code) => !(code in completed))),
    [completed, inProgress],
  );

  return (
    <div className="rounded-lg border bg-card p-3 text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-semibold">
            {formatCompletedCredits(credits)} credits
          </span>
          <span className="text-muted-foreground">
            {" · "}
            {codes.length} completed {codes.length === 1 ? "course" : "courses"}
          </span>
          {inProgressCredits > 0 && (
            <span className="text-muted-foreground">
              {" · "}
              {formatCompletedCredits(inProgressCredits)} cr in progress
            </span>
          )}
        </p>

        <AddProgramPopover
          index={index}
          status={status}
          selectedIds={selectedIds}
          onAdd={onAdd}
        />
      </div>

      {/* Per-program totals only. Credits overlap between programs, so a
          combined "earned across all programs" figure would be a lie. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {programs.map((program) => (
          <ProgramJumpChip key={program.id} program={program} />
        ))}
      </div>
    </div>
  );
}

function ProgramJumpChip({
  program,
}: {
  program: DegreeProgram;
}): React.ReactElement {
  const progress = useProgramProgress(program);

  return (
    <button
      type="button"
      onClick={() =>
        document
          .getElementById(programCardDomId(program.id))
          ?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] transition-colors hover:border-ring hover:text-foreground"
    >
      <span className="truncate">{program.name}</span>
      <span className="font-medium tabular-nums text-muted-foreground">
        {progress.percent === null
          ? `${formatCredits(progress.earnedCredits)} cr`
          : `${Math.round(progress.percent)}%`}
      </span>
    </button>
  );
}

function AddProgramPopover({
  index,
  status,
  selectedIds,
  onAdd,
}: {
  index: React.ComponentProps<typeof ProgramPicker>["index"];
  status: React.ComponentProps<typeof ProgramPicker>["status"];
  selectedIds: readonly string[];
  onAdd: (programId: string) => void;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5">
          <Plus className="size-3.5" />
          Add program
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(26rem,calc(100vw-2rem))] p-2"
      >
        <ProgramPicker
          index={index}
          status={status}
          selectedIds={selectedIds}
          onAdd={onAdd}
          autoFocus
          listClassName="max-h-64"
        />
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Course path sheet
// ---------------------------------------------------------------------------

function PathSheet({
  code,
  courses,
  onOpenCourse,
  onClose,
}: {
  code: string | null;
  courses: React.ComponentProps<typeof CoursePathView>["courses"] | null;
  onOpenCourse: (code: string) => void;
  onClose: () => void;
}): React.ReactElement {
  return (
    <Sheet
      open={code !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full gap-0 sm:max-w-lg">
        <SheetHeader className="border-b pb-3">
          <SheetTitle>{code ?? "Course path"}</SheetTitle>
          <SheetDescription>
            What you need before this course, and what it unlocks after.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {code === null ? null : courses === null ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <p className="text-xs text-muted-foreground">
                Loading the course catalog…
              </p>
            </div>
          ) : (
            <CoursePathView
              code={code}
              courses={courses}
              onOpenCourse={onOpenCourse}
              className="p-4"
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
