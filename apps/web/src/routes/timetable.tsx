import { Link, createFileRoute } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import type {
  CandidateTimetable,
  CourseInput,
  GenerationResult,
  GeneratorConfig,
  RuleConfig,
} from "@better-ttb/generator";
import type {
  Course,
  DayNumber,
  DeliveryMode,
  SectionCode,
  TtbCourseLookupResponse,
} from "@better-ttb/shared";
import { millisofdayToHHMM } from "@better-ttb/shared";
import {
  Check,
  ChevronRight,
  Copy,
  Download,
  FileJson,
  Layers,
  Plus,
  RotateCcw,
  Share2,
  Trash2,
  TriangleAlert,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import * as React from "react";

import { AppNav, MobileNav } from "@/components/app-nav";
import { CourseDetailSheet } from "@/components/course/course-detail-sheet";
import { ThemeToggle } from "@/components/theme-toggle";
import { WeekGrid } from "@/components/timetable/WeekGrid";
import type { BlockedWindow } from "@/components/timetable/WeekGrid";
import {
  GeneratePanelBody,
  candidateKey,
} from "@/components/timetable/GeneratePanelContent";
import { BUILDING_INDEX } from "@/lib/buildings";
import { daysWithClasses, hasTightTransfer } from "@/lib/itinerary";
import { buildWalkSecondsMap } from "@/lib/walk-matrix";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import buildings from "@/data/buildings.json";
import {
  DAY_OPTIONS,
  DELIVERY_MODE_OPTIONS,
  RULE_DESCRIPTIONS,
  RULE_KIND_ORDER,
  RULE_LABELS,
  blockedWindowsFromRules,
  createDefaultRule,
  ensureBlockedTimesRule,
  minutesToMillis,
  removeRuleById,
  toggleBlockedCell,
  updateRuleById,
  type RuleKind,
} from "@/lib/generator-prefs";
import { buildIcsCalendar } from "@/lib/ics";
import { extractLiveCourse, mergeLiveEnrolment } from "@/lib/live-course";
import { parsePlanJson } from "@/lib/plan-io";
import { useRequisiteGraph } from "@/lib/requisites/use-graph";
import {
  applyCandidateSelections,
  buildGeneratorCourseInputs,
  buildTermBlocks,
  computeCreditTotals,
  courseKey,
  daysOnCampusCount,
  detectLinkageViolationSectionKeys,
  getActivePlanCourses,
  pinnedKey,
  planSelectedFromTimetableSections,
  selectedSectionsFromCandidate,
  selectedSectionsFromPlan,
  totalWalkMinutes,
  type SelectedTimetableSection,
  type Term,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
import { useCatalogStore } from "@/stores/catalog";
import {
  DEFAULT_PLAN_SESSIONS,
  activePlanFromState,
  createDefaultGeneratorPrefs,
  type GeneratorPrefs,
  type GeneratorSortKey,
  type Plan,
  usePlanStore,
} from "@/stores/plan";
import type {
  GeneratorWorkerMessage,
  GeneratorWorkerRequest,
} from "@/workers/generator-contract";

export const Route = createFileRoute("/timetable")({
  head: () => ({ meta: [{ title: "Timetable · better-ttb" }] }),
  component: TimetableRoute,
});

interface BuildingRecord {
  code: string;
  lat: number;
  lng: number;
}

const NO_ADD_RULE = "__add_rule__";
const TERMS: Term[] = ["fall", "winter"];
const TERM_LABELS: Record<Term, string> = {
  fall: "Fall",
  winter: "Winter",
};
const buildingCoordinates = Object.fromEntries(
  (buildings as BuildingRecord[]).map((building) => [
    building.code,
    { lat: building.lat, lng: building.lng },
  ]),
);

function TimetableRoute() {
  const posthog = usePostHog();
  const status = useCatalogStore((state) => state.status);
  const catalog = useCatalogStore((state) => state.catalog);
  const catalogError = useCatalogStore((state) => state.error);
  const loadCatalog = useCatalogStore((state) => state.loadCatalog);
  const plans = usePlanStore((state) => state.plans);
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const setActivePlan = usePlanStore((state) => state.setActivePlan);
  const newPlan = usePlanStore((state) => state.newPlan);
  const choose = usePlanStore((state) => state.choose);
  const clearChoice = usePlanStore((state) => state.clearChoice);
  const pinCourse = usePlanStore((state) => state.pin);
  const unpinCourse = usePlanStore((state) => state.unpin);
  const resetAllChoices = usePlanStore((state) => state.resetAllChoices);
  const importPlan = usePlanStore((state) => state.importPlan);
  const updatePlanPrefs = usePlanStore((state) => state.updatePlanPrefs);
  const activePlan = React.useMemo(
    () => activePlanFromState({ plans, activePlanId }),
    [activePlanId, plans],
  );
  const generatorPrefs = activePlan.prefs.generator ?? createDefaultGeneratorPrefs();
  const [term, setTerm] = React.useState<Term>("fall");
  const [panelOpen, setPanelOpen] = React.useState(true);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [blockoutMode, setBlockoutMode] = React.useState(false);
  const [selectedCourseKey, setSelectedCourseKey] = React.useState<string | null>(null);
  const [liveCourses, setLiveCourses] = React.useState<Map<string, Course>>(
    () => new Map(),
  );
  const [refreshingCourseKey, setRefreshingCourseKey] = React.useState<
    string | null
  >(null);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [shareUrl, setShareUrl] = React.useState("");
  const [shareError, setShareError] = React.useState<string | null>(null);
  const [sharing, setSharing] = React.useState(false);
  const [workerState, setWorkerState] = React.useState<"idle" | "running" | "done" | "error">("idle");
  const [workerError, setWorkerError] = React.useState<string | null>(null);
  const [generationResult, setGenerationResult] = React.useState<GenerationResult | null>(null);
  const [previewCandidate, setPreviewCandidate] = React.useState<CandidateTimetable | null>(null);
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const workerRef = React.useRef<Worker | null>(null);
  const activeSessionsKey = activePlan.sessions.join(",");

  React.useEffect(() => {
    void loadCatalog(activePlan.sessions);
  }, [activePlan.sessions, activeSessionsKey, loadCatalog]);

  React.useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const coursesByKey = React.useMemo(() => {
    const map = new Map<string, Course>();

    catalog?.courses.forEach((course) => map.set(courseKey(course), course));
    liveCourses.forEach((course, key) => map.set(key, course));
    return map;
  }, [catalog, liveCourses]);
  const graph = useRequisiteGraph(catalog?.courses);
  const activeCourses = React.useMemo(
    () => getActivePlanCourses(activePlan, coursesByKey),
    [activePlan, coursesByKey],
  );
  const visibleSelections = React.useMemo(
    () =>
      previewCandidate
        ? selectedSectionsFromCandidate(activePlan, coursesByKey, previewCandidate)
        : selectedSectionsFromPlan(activePlan, coursesByKey),
    [activePlan, coursesByKey, previewCandidate],
  );
  const disallowedSectionKeys = React.useMemo(
    () =>
      detectLinkageViolationSectionKeys(
        planSelectedFromTimetableSections(visibleSelections),
      ),
    [visibleSelections],
  );
  const termData = React.useMemo(
    () => ({
      fall: buildTermBlocks(visibleSelections, "fall", {
        preview: Boolean(previewCandidate),
        disallowedSectionKeys,
      }),
      winter: buildTermBlocks(visibleSelections, "winter", {
        preview: Boolean(previewCandidate),
        disallowedSectionKeys,
      }),
    }),
    [disallowedSectionKeys, previewCandidate, visibleSelections],
  );
  const creditTotals = React.useMemo(
    () => computeCreditTotals(activePlan, coursesByKey),
    [activePlan, coursesByKey],
  );
  const hasConflicts = TERMS.some((entry) =>
    termData[entry].blocks.some((block) => block.conflict),
  );
  const hasDisallowed = TERMS.some((entry) =>
    termData[entry].blocks.some((block) => block.disallowed),
  );
  const tightTransferLink = React.useMemo(
    () => findTightTransferLink(visibleSelections),
    [visibleSelections],
  );
  const selectedCourse = selectedCourseKey ? coursesByKey.get(selectedCourseKey) ?? null : null;
  const planSelectedSections = React.useMemo(
    () =>
      planSelectedFromTimetableSections(
        selectedSectionsFromPlan(activePlan, coursesByKey),
      ),
    [activePlan, coursesByKey],
  );
  const selectedCoursePinned = selectedCourse
    ? activePlan.pinned.some(
        (entry) =>
          entry.courseCode === selectedCourse.code &&
          entry.sectionCode === selectedCourse.sectionCode,
      )
    : false;
  const blockedWindows = React.useMemo(
    () => blockedWindowsFromRules(generatorPrefs.rules),
    [generatorPrefs.rules],
  );
  const sortedCandidates = React.useMemo(
    () => sortCandidates(generationResult?.candidates ?? [], generatorPrefs.sort),
    [generationResult?.candidates, generatorPrefs.sort],
  );
  const previewKey = previewCandidate ? candidateKey(previewCandidate) : null;

  function setGeneratorPrefs(updater: (prefs: GeneratorPrefs) => GeneratorPrefs) {
    updatePlanPrefs(activePlan.id, (prefs) => ({
      ...prefs,
      generator: updater(prefs.generator ?? createDefaultGeneratorPrefs()),
    }));
  }

  async function refreshSeats(course: Course) {
    const key = courseKey(course);

    setRefreshingCourseKey(key);
    setRefreshError(null);

    try {
      const params = new URLSearchParams({ sectionCode: course.sectionCode });
      const response = await fetch(`/api/course/${course.code}?${params.toString()}`);

      if (!response.ok) {
        throw new Error(`Refresh failed with HTTP ${response.status}`);
      }

      const liveCourse = extractLiveCourse(
        (await response.json()) as TtbCourseLookupResponse,
        course.sectionCode,
      );

      if (!liveCourse) {
        throw new Error("Live course response did not include this offering");
      }

      setLiveCourses((current) => {
        const next = new Map(current);
        next.set(key, mergeLiveEnrolment(course, liveCourse));
        return next;
      });
    } catch (refreshErrorValue) {
      setRefreshError(
        refreshErrorValue instanceof Error
          ? refreshErrorValue.message
          : String(refreshErrorValue),
      );
    } finally {
      setRefreshingCourseKey(null);
    }
  }

  function setRules(rules: RuleConfig[]) {
    setGeneratorPrefs((prefs) => ({ ...prefs, rules }));
  }

  function setSort(sort: GeneratorSortKey) {
    setGeneratorPrefs((prefs) => ({ ...prefs, sort }));
  }

  function toggleBlockoutMode() {
    if (!blockoutMode) {
      setRules(ensureBlockedTimesRule(generatorPrefs.rules));
      // Enabling paint mode from inside the mobile drawer would hide the grid;
      // close the drawer so the user can immediately paint on the main grid.
      setDrawerOpen(false);
    }

    setBlockoutMode((current) => !current);
  }

  function paintBlockedCell(day: DayNumber, startMillis: number, endMillis: number) {
    setRules(toggleBlockedCell(generatorPrefs.rules, day, startMillis, endMillis));
  }

  function runGenerator() {
    const courses = buildGeneratorCourseInputs(activePlan, coursesByKey);

    if (courses.length === 0) {
      setWorkerState("error");
      setWorkerError("Pin at least one course before generating.");
      setGenerationResult(null);
      return;
    }

    workerRef.current?.terminate();
    // Only flatten walk-matrix pairs among the buildings that actually appear in
    // this plan's courses, keeping the worker message small.
    const walkSeconds = buildWalkSecondsMap(buildingCodesFromCourseInputs(courses));
    const request: GeneratorWorkerRequest = {
      type: "generate",
      id: createRequestId(),
      courses,
      config: {
        rules: generatorPrefs.rules,
        maxResults: 12,
        maxCombinations: 500_000,
        buildings: buildingCoordinates,
        walkSeconds,
      } satisfies GeneratorConfig,
    };
    const worker = new Worker(new URL("../workers/generator.worker.ts", import.meta.url), {
      type: "module",
    });

    workerRef.current = worker;
    setWorkerState("running");
    setWorkerError(null);
    setGenerationResult(null);
    setPreviewCandidate(null);

    posthog.capture("timetable_generated", {
      course_count: courses.length,
      rule_count: request.config.rules.length,
    });

    worker.addEventListener("message", (event: MessageEvent<GeneratorWorkerMessage>) => {
      if (event.data.id !== request.id) {
        return;
      }

      if (event.data.type === "started") {
        setWorkerState("running");
        return;
      }

      if (event.data.type === "done") {
        setGenerationResult(event.data.result);
        setWorkerState("done");
        worker.terminate();
        workerRef.current = null;
        return;
      }

      setWorkerError(event.data.message);
      setWorkerState("error");
      worker.terminate();
      workerRef.current = null;
    });

    worker.postMessage(request);
  }

  function applyPreview() {
    if (!previewCandidate) {
      return;
    }

    posthog.capture("generated_candidate_applied", {
      candidate_score: previewCandidate.score,
    });

    applyCandidateSelections(activePlan, coursesByKey, previewCandidate).forEach((selection) => {
      choose(
        selection.courseCode,
        selection.sectionCode,
        selection.teachMethod,
        selection.sectionName,
      );
    });
    setPreviewCandidate(null);
  }

  async function sharePlan() {
    setSharing(true);
    setShareError(null);

    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PostHog-Session-Id": posthog.get_session_id() ?? "",
          "X-PostHog-Distinct-Id": posthog.get_distinct_id() ?? "",
        },
        body: JSON.stringify({ plan: activePlan }),
      });

      if (!response.ok) {
        throw new Error(`Share failed with HTTP ${response.status}`);
      }

      const body = (await response.json()) as { id?: unknown };

      if (typeof body.id !== "string") {
        throw new Error("Share response did not include an id");
      }

      const url = `${window.location.origin}/p/${body.id}`;
      setShareUrl(url);
      setShareOpen(true);
      posthog.capture("plan_shared", {
        pinned_course_count: activePlan.pinned.length,
      });
    } catch (error) {
      setShareError(error instanceof Error ? error.message : String(error));
      setShareOpen(true);
    } finally {
      setSharing(false);
    }
  }

  function exportPlanJson() {
    posthog.capture("plan_exported_json", {
      pinned_course_count: activePlan.pinned.length,
    });
    downloadText(
      `${activePlan.name.replace(/\W+/g, "-").toLowerCase()}-plan.json`,
      "application/json",
      JSON.stringify(activePlan, null, 2),
    );
  }

  async function importPlanJson(file: File) {
    const plan = parsePlanJson(await file.text());

    if (!plan) {
      window.alert("The selected file is not a valid better-ttb plan export.");
      return;
    }

    importPlan(plan, `${plan.name} Import`);
    posthog.capture("plan_imported", {
      pinned_course_count: plan.pinned.length,
    });
  }

  function exportIcs() {
    posthog.capture("plan_exported_ics", {
      pinned_course_count: activePlan.pinned.length,
    });
    const selectedSections = selectedSectionsFromPlan(activePlan, coursesByKey);
    const ics = buildIcsCalendar({
      calendarName: activePlan.name,
      selectedSections,
    });

    downloadText(
      `${activePlan.name.replace(/\W+/g, "-").toLowerCase()}-timetable.ics`,
      "text/calendar;charset=utf-8",
      ics,
    );
  }

  return (
    <TooltipProvider>
      <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <TimetableHeader
          activePlan={activePlan}
          plans={plans}
          onSetActivePlan={(planId) => {
            setPreviewCandidate(null);
            setActivePlan(planId);
          }}
          onNewPlan={() => newPlan(DEFAULT_PLAN_SESSIONS)}
          onShare={sharePlan}
          onExportIcs={exportIcs}
          onExportJson={exportPlanJson}
          onImportJson={() => importInputRef.current?.click()}
          sharing={sharing}
        />

        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";

            if (file) {
              void importPlanJson(file);
            }
          }}
        />

        <div
          className="grid min-h-0 flex-1 grid-cols-1 border-t pb-16 md:pb-0 lg:grid-cols-[var(--tt-cols)]"
          style={
            {
              "--tt-cols": panelOpen
                ? "minmax(0,1fr) minmax(340px,390px)"
                : "minmax(0,1fr) 44px",
            } as React.CSSProperties
          }
        >
          <section className="min-h-0 overflow-y-auto bg-muted/20 p-4">
            <div className="mx-auto flex max-w-7xl flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold">Timetable</h2>
                  <p className="text-sm text-muted-foreground">
                    {activeCourses.length} pinned courses · {visibleSelections.length} scheduled sections
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {tightTransferLink && (
                    <Button asChild type="button" size="sm" variant="outline" className="border-destructive/50 text-destructive hover:text-destructive">
                      <Link to="/map" search={tightTransferLink}>
                        <TriangleAlert />
                        Tight walk
                      </Link>
                    </Button>
                  )}
                  <Tabs value={term} onValueChange={(value) => setTerm(value as Term)}>
                    <TabsList>
                      <TabsTrigger value="fall">
                        Fall
                        <Badge variant="secondary">{creditTotals.fall.toFixed(1)}</Badge>
                      </TabsTrigger>
                      <TabsTrigger value="winter">
                        Winter
                        <Badge variant="secondary">{creditTotals.winter.toFixed(1)}</Badge>
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </div>

              {shareError && (
                <Banner tone="error">Share failed: {shareError}</Banner>
              )}
              {catalogError && <Banner tone="warn">Catalog warning: {catalogError}</Banner>}
              {status === "loading" && <Banner>Loading catalog for this plan.</Banner>}
              {status === "empty" && (
                <Banner tone="warn">
                  Catalog not scraped yet. Run POST /api/admin/scrape to populate courses.
                </Banner>
              )}
              {hasConflicts && (
                <Banner tone="error">
                  Conflicts detected. Overlapping blocks are outlined in red.
                </Banner>
              )}
              {hasDisallowed && (
                <Banner tone="warn">
                  Invalid selections detected. Some chosen sections must be taken together with a different lecture or tutorial — greyed blocks show which.
                </Banner>
              )}
              {previewCandidate && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed bg-background p-3">
                  <div>
                    <p className="text-sm font-medium">Preview mode</p>
                    <p className="text-xs text-muted-foreground">
                      Dashed blocks show the generated candidate before it is written to the plan.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" size="sm" onClick={applyPreview}>
                      <Check />
                      Apply
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPreviewCandidate(null)}
                    >
                      <X />
                      Discard
                    </Button>
                  </div>
                </div>
              )}

              <WeekGrid
                blocks={termData[term].blocks}
                blockedWindows={blockedWindows}
                blockoutEnabled={blockoutMode}
                onPaintCell={paintBlockedCell}
                onBlockClick={(block) => setSelectedCourseKey(block.courseKey)}
              />

              <UnscheduledList
                term={term}
                creditTotal={term === "fall" ? creditTotals.fall : creditTotals.winter}
                unscheduled={termData[term].unscheduled}
              />
            </div>
          </section>

          {panelOpen ? (
            <GeneratePanel
              className="hidden md:flex"
              activePlan={activePlan}
              courses={activeCourses}
              rules={generatorPrefs.rules}
              blockedWindows={blockedWindows}
              blockoutMode={blockoutMode}
              workerState={workerState}
              workerError={workerError}
              result={generationResult}
              sort={generatorPrefs.sort}
              sortedCandidates={sortedCandidates}
              previewKey={previewKey}
              onClose={() => setPanelOpen(false)}
              onResetAll={resetAllChoices}
              onRun={runGenerator}
              onRulesChange={setRules}
              onToggleBlockout={toggleBlockoutMode}
              onPreviewCandidate={setPreviewCandidate}
              onApplyPreview={applyPreview}
              onDiscardPreview={() => setPreviewCandidate(null)}
              onSortChange={setSort}
            />
          ) : (
            <aside className="hidden items-start justify-center border-l bg-background p-2 md:flex">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setPanelOpen(true)}
                  >
                    <Wand2 />
                    <span className="sr-only">Open generator</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open generator</TooltipContent>
              </Tooltip>
            </aside>
          )}
        </div>

        <Button
          type="button"
          className="fixed right-4 bottom-20 z-40 shadow-lg md:hidden"
          onClick={() => setDrawerOpen(true)}
        >
          <Wand2 />
          Generate
        </Button>

        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerContent className="h-[85vh] md:hidden">
            <DrawerHeader className="border-b text-left">
              <DrawerTitle>Generate</DrawerTitle>
              <DrawerDescription>Rules, locks, and candidates</DrawerDescription>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <GeneratePanelBody
                activePlan={activePlan}
                courses={activeCourses}
                rules={generatorPrefs.rules}
                blockedWindows={blockedWindows}
                blockoutMode={blockoutMode}
                workerState={workerState}
                workerError={workerError}
                result={generationResult}
                sort={generatorPrefs.sort}
                sortedCandidates={sortedCandidates}
                previewKey={previewKey}
                renderLockedChoices={() => (
                  <LockedChoicesHint
                    activePlan={activePlan}
                    courses={activeCourses}
                    onResetAll={resetAllChoices}
                  />
                )}
                renderRuleEditor={() => (
                  <RuleEditor rules={generatorPrefs.rules} onRulesChange={setRules} />
                )}
                onRun={runGenerator}
                onToggleBlockout={toggleBlockoutMode}
                onPreviewCandidate={setPreviewCandidate}
                onApplyPreview={applyPreview}
                onDiscardPreview={() => setPreviewCandidate(null)}
                onSortChange={setSort}
              />
            </div>
          </DrawerContent>
        </Drawer>

        <CourseDetailSheet
          course={selectedCourse}
          activePlan={activePlan}
          planSelectedSections={planSelectedSections}
          refreshError={refreshError}
          refreshing={selectedCourseKey === refreshingCourseKey}
          pinned={selectedCoursePinned}
          graph={graph}
          onChoose={choose}
          onClearChoice={clearChoice}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedCourseKey(null);
            }
          }}
          onPin={(course) => pinCourse(course.code, course.sectionCode)}
          onUnpin={(course) => unpinCourse(course.code, course.sectionCode)}
          onRefresh={refreshSeats}
          onOpenCourse={(code) => {
            const resolved = resolveCourseKey(code, coursesByKey);
            if (resolved) {
              setSelectedCourseKey(resolved);
            }
          }}
        />

        <Dialog open={shareOpen} onOpenChange={setShareOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Share plan</DialogTitle>
              <DialogDescription>
                Anyone with the URL can view the read-only plan summary.
              </DialogDescription>
            </DialogHeader>
            {shareError ? (
              <p className="text-sm text-destructive">{shareError}</p>
            ) : (
              <div className="flex gap-2">
                <Input readOnly value={shareUrl} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void navigator.clipboard?.writeText(shareUrl)}
                >
                  <Copy />
                  Copy
                </Button>
              </div>
            )}
            <DialogFooter showCloseButton />
          </DialogContent>
        </Dialog>

        <MobileNav />
      </main>
    </TooltipProvider>
  );
}

function TimetableHeader({
  activePlan,
  plans,
  sharing,
  onSetActivePlan,
  onNewPlan,
  onShare,
  onExportIcs,
  onExportJson,
  onImportJson,
}: {
  activePlan: Plan;
  plans: Plan[];
  sharing: boolean;
  onSetActivePlan: (planId: string) => void;
  onNewPlan: () => void;
  onShare: () => void;
  onExportIcs: () => void;
  onExportJson: () => void;
  onImportJson: () => void;
}) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-4">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Layers className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">Better TTB</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">By Evan Yu</p>
          </div>
        </div>

        <AppNav />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Select value={activePlan.id} onValueChange={onSetActivePlan}>
          <SelectTrigger className="w-[110px] min-w-0 sm:w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {plans.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {plan.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="icon-sm">
              <FileJson />
              <span className="sr-only">Plan import and export</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-2">
            <div className="space-y-1">
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={onNewPlan}>
                <Plus />
                New plan
              </Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={onExportJson}>
                <Download />
                Export JSON
              </Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={onImportJson}>
                <Upload />
                Import JSON
              </Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start sm:hidden" onClick={onExportIcs}>
                <Download />
                Export ICS
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Button type="button" variant="outline" size="sm" className="hidden sm:inline-flex" onClick={onExportIcs}>
          <Download />
          ICS
        </Button>
        <Button type="button" size="sm" onClick={onShare} disabled={sharing}>
          <Share2 />
          <span className="hidden sm:inline">Share</span>
        </Button>
        <ThemeToggle />
      </div>
    </header>
  );
}

function GeneratePanel({
  className,
  activePlan,
  courses,
  rules,
  blockedWindows,
  blockoutMode,
  workerState,
  workerError,
  result,
  sort,
  sortedCandidates,
  previewKey,
  onClose,
  onResetAll,
  onRun,
  onRulesChange,
  onToggleBlockout,
  onPreviewCandidate,
  onApplyPreview,
  onDiscardPreview,
  onSortChange,
}: {
  className?: string;
  activePlan: Plan;
  courses: Course[];
  rules: RuleConfig[];
  blockedWindows: BlockedWindow[];
  blockoutMode: boolean;
  workerState: "idle" | "running" | "done" | "error";
  workerError: string | null;
  result: GenerationResult | null;
  sort: GeneratorSortKey;
  sortedCandidates: CandidateTimetable[];
  previewKey: string | null;
  onClose: () => void;
  onResetAll: () => void;
  onRun: () => void;
  onRulesChange: (rules: RuleConfig[]) => void;
  onToggleBlockout: () => void;
  onPreviewCandidate: (candidate: CandidateTimetable) => void;
  onApplyPreview: () => void;
  onDiscardPreview: () => void;
  onSortChange: (sort: GeneratorSortKey) => void;
}) {
  return (
    <aside className={cn("min-h-0 flex-col overflow-y-auto border-l bg-background", className)}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background p-4">
        <div>
          <h2 className="text-sm font-semibold">Generate</h2>
          <p className="text-xs text-muted-foreground">Rules, locks, and candidates</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose}>
          <ChevronRight />
          <span className="sr-only">Collapse generator</span>
        </Button>
      </div>

      <GeneratePanelBody
        activePlan={activePlan}
        courses={courses}
        rules={rules}
        blockedWindows={blockedWindows}
        blockoutMode={blockoutMode}
        workerState={workerState}
        workerError={workerError}
        result={result}
        sort={sort}
        sortedCandidates={sortedCandidates}
        previewKey={previewKey}
        renderLockedChoices={() => (
          <LockedChoicesHint
            activePlan={activePlan}
            courses={courses}
            onResetAll={onResetAll}
          />
        )}
        renderRuleEditor={() => (
          <RuleEditor rules={rules} onRulesChange={onRulesChange} />
        )}
        onRun={onRun}
        onToggleBlockout={onToggleBlockout}
        onPreviewCandidate={onPreviewCandidate}
        onApplyPreview={onApplyPreview}
        onDiscardPreview={onDiscardPreview}
        onSortChange={onSortChange}
      />
    </aside>
  );
}

// Chosen sections are auto-locked by the generator now, so this is a read-only
// summary of what will stay fixed rather than an interactive lock toggle.
function LockedChoicesHint({
  activePlan,
  courses,
  onResetAll,
}: {
  activePlan: Plan;
  courses: Course[];
  onResetAll: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const lockedCourses = courses.flatMap((course) => {
    const key = courseKey(course);
    const pinned = activePlan.pinned.find((entry) => pinnedKey(entry) === key);

    if (!pinned) {
      return [];
    }

    const choices = Object.entries(pinned.chosen)
      .filter((entry): entry is [string, string] =>
        typeof entry[1] === "string" && entry[1].length > 0,
      )
      .map(([teachMethod, sectionName]) => `${teachMethod} ${sectionName}`);

    if (choices.length === 0) {
      return [];
    }

    return [{ code: course.code, key, choices }];
  });

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Locked choices</h3>
        {lockedCourses.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => setConfirmOpen(true)}
          >
            <RotateCcw />
            Reset all to Auto
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Sections you&apos;ve picked in your plan are kept fixed. Clear a section
        choice (set it to Auto) to let the generator optimize it.
      </p>
      {lockedCourses.length > 0 && (
        <ul className="space-y-1.5">
          {lockedCourses.map((entry) => (
            <li key={entry.key} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium">{entry.code}</span>
              {entry.choices.map((choice) => (
                <Badge key={choice} variant="secondary" className="font-normal">
                  {choice}
                </Badge>
              ))}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset all courses to Auto?</DialogTitle>
            <DialogDescription>
              This clears every locked section choice across all{" "}
              {lockedCourses.length} course{lockedCourses.length === 1 ? "" : "s"}{" "}
              in this plan, letting the generator optimize each one. Your pinned
              courses stay pinned.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onResetAll();
                setConfirmOpen(false);
              }}
            >
              <RotateCcw />
              Reset all to Auto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RuleEditor({
  rules,
  onRulesChange,
}: {
  rules: RuleConfig[];
  onRulesChange: (rules: RuleConfig[]) => void;
}) {
  const remainingKinds = RULE_KIND_ORDER.filter(
    (kind) => !rules.some((rule) => rule.kind === kind),
  );

  function update(ruleId: string, updater: (rule: RuleConfig) => RuleConfig) {
    onRulesChange(updateRuleById(rules, ruleId, updater));
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rules.map((rule) => (
          <div key={rule.id} className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{RULE_LABELS[rule.kind]}</p>
                <p className="text-xs text-muted-foreground">{RULE_DESCRIPTIONS[rule.kind]}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Soft</span>
                <Switch
                  checked={rule.mode === "hard"}
                  onCheckedChange={(checked) =>
                    update(rule.id, (current) => ({
                      ...current,
                      mode: checked ? "hard" : "soft",
                    }) as RuleConfig)
                  }
                />
                <span className="text-xs text-muted-foreground">Hard</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onRulesChange(removeRuleById(rules, rule.id))}
                >
                  <Trash2 />
                  <span className="sr-only">Remove rule</span>
                </Button>
              </div>
            </div>

            <RuleParamControls
              rule={rule}
              onChange={(nextRule) => update(rule.id, () => nextRule)}
            />

            {rule.mode === "soft" && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Weight</span>
                  <span>{rule.weight.toFixed(2)}</span>
                </div>
                <Slider
                  value={[rule.weight]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={(value) =>
                    update(rule.id, (current) => ({
                      ...current,
                      weight: value[0] ?? current.weight,
                    }) as RuleConfig)
                  }
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <Select
        value={NO_ADD_RULE}
        onValueChange={(value) => {
          if (value !== NO_ADD_RULE) {
            onRulesChange([...rules, createDefaultRule(value as RuleKind)]);
          }
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Add rule" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_ADD_RULE} disabled>
            Add rule
          </SelectItem>
          {remainingKinds.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {RULE_LABELS[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function RuleParamControls({
  rule,
  onChange,
}: {
  rule: RuleConfig;
  onChange: (rule: RuleConfig) => void;
}) {
  switch (rule.kind) {
    case "max-gap":
      return (
        <NumberSlider
          label="Max gap"
          value={rule.maxGapMinutes}
          min={0}
          max={240}
          step={15}
          suffix="min"
          onChange={(value) => onChange({ ...rule, maxGapMinutes: value })}
        />
      );
    case "max-walk":
      return (
        <NumberSlider
          label="Max walk"
          value={rule.maxWalkMinutes}
          min={0}
          max={30}
          step={1}
          suffix="min"
          onChange={(value) => onChange({ ...rule, maxWalkMinutes: value })}
        />
      );
    case "blocked-times":
      return (
        <p className="text-xs text-muted-foreground">
          {rule.windows.length} windows. Use Block out to paint cells on the grid.
        </p>
      );
    case "earliest-start":
      return (
        <TimeSelect
          label="No starts before"
          value={rule.millisofday}
          onChange={(value) => onChange({ ...rule, millisofday: value })}
        />
      );
    case "latest-end":
      return (
        <TimeSelect
          label="No ends after"
          value={rule.millisofday}
          onChange={(value) => onChange({ ...rule, millisofday: value })}
        />
      );
    case "days-off":
      return (
        <div className="space-y-3">
          <NumberSlider
            label="Free days target"
            value={rule.count ?? 1}
            min={0}
            max={4}
            step={1}
            suffix="days"
            onChange={(value) => {
              onChange(makeDaysOffRule(rule, [], value));
            }}
          />
          <div className="flex flex-wrap gap-1">
            {DAY_OPTIONS.map((day) => {
              const active = rule.days?.includes(day.value) ?? false;

              return (
                <Button
                  key={day.value}
                  type="button"
                  variant={active ? "secondary" : "outline"}
                  size="xs"
                  onClick={() => {
                    const days = toggleValue(rule.days ?? [], day.value);
                    onChange(makeDaysOffRule(rule, days, rule.count ?? 1));
                  }}
                >
                  {day.label}
                </Button>
              );
            })}
          </div>
        </div>
      );
    case "compactness":
      return (
        <LabeledSelect
          label="Preference"
          value={rule.preference}
          options={[
            { value: "compact", label: "Compact" },
            { value: "spread", label: "Spread" },
          ]}
          onChange={(value) =>
            onChange({ ...rule, preference: value as "compact" | "spread" })
          }
        />
      );
    case "lunch-break":
      return (
        <div className="grid gap-2">
          <TimeSelect
            label="Lunch starts"
            value={rule.startMillis}
            onChange={(value) => onChange({ ...rule, startMillis: value })}
          />
          <TimeSelect
            label="Lunch ends"
            value={rule.endMillis}
            onChange={(value) => onChange({ ...rule, endMillis: value })}
          />
          <NumberSlider
            label="Minimum break"
            value={rule.minMinutes}
            min={15}
            max={90}
            step={15}
            suffix="min"
            onChange={(value) => onChange({ ...rule, minMinutes: value })}
          />
        </div>
      );
    case "avoid-full-sections":
    case "avoid-waitlist":
      return <p className="text-xs text-muted-foreground">No parameters.</p>;
    case "prefer-delivery":
      return (
        <div className="flex flex-wrap gap-1">
          {DELIVERY_MODE_OPTIONS.map((mode) => {
            const active = rule.modes.includes(mode.value);

            return (
              <Button
                key={mode.value}
                type="button"
                variant={active ? "secondary" : "outline"}
                size="xs"
                onClick={() =>
                  onChange({
                    ...rule,
                    modes: toggleValue(rule.modes, mode.value) as DeliveryMode[],
                  })
                }
              >
                {mode.label}
              </Button>
            );
          })}
        </div>
      );
    case "prefer-instructor":
      return (
        <Input
          value={rule.names.join(", ")}
          placeholder="Instructor names"
          onChange={(event) =>
            onChange({
              ...rule,
              names: event.target.value
                .split(",")
                .map((name) => name.trim())
                .filter(Boolean),
            })
          }
        />
      );
  }
}

function NumberSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>
          {value} {suffix}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => onChange(next[0] ?? value)}
      />
    </div>
  );
}

function TimeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const options = React.useMemo(() => buildTimeOptions(7, 22), []);

  return (
    <LabeledSelect
      label={label}
      value={String(value)}
      options={options.map((option) => ({
        value: String(option.value),
        label: option.label,
      }))}
      onChange={(next) => onChange(Number(next))}
    />
  );
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-[120px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function UnscheduledList({
  term,
  creditTotal,
  unscheduled,
}: {
  term: Term;
  creditTotal: number;
  unscheduled: ReturnType<typeof buildTermBlocks>["unscheduled"];
}) {
  return (
    <section className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{TERM_LABELS[term]} details</h3>
        <Badge variant="outline">{creditTotal.toFixed(1)} credits</Badge>
      </div>
      {unscheduled.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {unscheduled.map((section) => (
            <Badge key={section.key} variant="secondary">
              {section.courseCode} {section.sectionName}: {section.reason}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          No chosen sections without meeting times.
        </p>
      )}
    </section>
  );
}

const SECTION_PREFERENCE: SectionCode[] = ["F", "S", "Y"];

/**
 * Resolves a course reference (bare code like "CSC207H1" or a full
 * "code:sectionCode" key) to a key present in `coursesByKey`, preferring
 * F/S/Y offerings in that order when only a bare code is given.
 */
function resolveCourseKey(
  value: string,
  coursesByKey: Map<string, Course>,
): string | null {
  const [code, section] = value.split(":");

  if (section) {
    return coursesByKey.has(value) ? value : null;
  }

  for (const preference of SECTION_PREFERENCE) {
    const candidate = `${code}:${preference}`;

    if (coursesByKey.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function Banner({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warn" | "error";
}) {
  return (
    <div
      className={cn(
        "rounded-md border bg-background px-3 py-2 text-sm",
        tone === "warn" &&
          "border-amber-400/50 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
        tone === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
      )}
    >
      {children}
    </div>
  );
}

function sortCandidates(
  candidates: readonly CandidateTimetable[],
  sort: GeneratorSortKey,
): CandidateTimetable[] {
  return [...candidates].sort((left, right) => {
    switch (sort) {
      case "walking":
        return totalWalkMinutes(left) - totalWalkMinutes(right) || right.score - left.score;
      case "earliest-start":
        return (
          (left.extras.earliestStart ?? Number.MAX_SAFE_INTEGER) -
            (right.extras.earliestStart ?? Number.MAX_SAFE_INTEGER) ||
          right.score - left.score
        );
      case "days-on-campus":
        return daysOnCampusCount(left) - daysOnCampusCount(right) || right.score - left.score;
      case "score":
        return right.score - left.score;
    }
  });
}

function findTightTransferLink(
  selectedSections: SelectedTimetableSection[],
): { term: Term; day: DayNumber } | null {
  for (const term of TERMS) {
    if (!hasTightTransfer(selectedSections, BUILDING_INDEX, term)) {
      continue;
    }

    const days = daysWithClasses(selectedSections, BUILDING_INDEX, term);

    return { term, day: days[0] ?? 1 };
  }

  return null;
}

function buildTimeOptions(startHour: number, endHour: number): Array<{ value: number; label: string }> {
  const options: Array<{ value: number; label: string }> = [];

  for (let minutes = startHour * 60; minutes <= endHour * 60; minutes += 30) {
    const value = minutesToMillis(minutes);
    options.push({ value, label: millisofdayToHHMM(value) });
  }

  return options;
}

function toggleValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function makeDaysOffRule(
  rule: Extract<RuleConfig, { kind: "days-off" }>,
  days: DayNumber[],
  count: number,
): Extract<RuleConfig, { kind: "days-off" }> {
  const next: Extract<RuleConfig, { kind: "days-off" }> = {
    id: rule.id,
    kind: rule.kind,
    mode: rule.mode,
    weight: rule.weight,
  };

  if (days.length > 0) {
    next.days = days;
  } else {
    next.count = count;
  }

  return next;
}

function downloadText(filename: string, type: string, content: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildingCodesFromCourseInputs(courses: readonly CourseInput[]): string[] {
  const codes = new Set<string>();

  for (const input of courses) {
    for (const section of input.course.sections) {
      for (const meeting of section.meetingTimes) {
        const code = meeting.building.buildingCode.trim();

        if (code) {
          codes.add(code);
        }
      }
    }
  }

  return [...codes];
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
}
