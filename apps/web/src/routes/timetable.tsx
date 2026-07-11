import { Link, createFileRoute } from "@tanstack/react-router";
import type {
  CandidateTimetable,
  GenerationResult,
  GeneratorConfig,
  RuleConfig,
} from "@better-ttb/generator";
import type { Course, DayNumber, DeliveryMode } from "@better-ttb/shared";
import { formatSessionLabel, millisofdayToHHMM } from "@better-ttb/shared";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileJson,
  Layers,
  Lock,
  MapIcon,
  Paintbrush,
  Plus,
  Share2,
  Trash2,
  TriangleAlert,
  Unlock,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import * as React from "react";

import { WeekGrid } from "@/components/timetable/WeekGrid";
import type { BlockedWindow } from "@/components/timetable/WeekGrid";
import { BUILDING_INDEX } from "@/lib/buildings";
import { daysWithClasses, hasTightTransfer } from "@/lib/itinerary";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { parsePlanJson } from "@/lib/plan-io";
import {
  applyCandidateSelections,
  buildGeneratorCourseInputs,
  buildTermBlocks,
  computeCreditTotals,
  courseKey,
  daysOnCampusCount,
  getActivePlanCourses,
  pinnedKey,
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
  const status = useCatalogStore((state) => state.status);
  const catalog = useCatalogStore((state) => state.catalog);
  const catalogError = useCatalogStore((state) => state.error);
  const loadCatalog = useCatalogStore((state) => state.loadCatalog);
  const plans = usePlanStore((state) => state.plans);
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const setActivePlan = usePlanStore((state) => state.setActivePlan);
  const newPlan = usePlanStore((state) => state.newPlan);
  const choose = usePlanStore((state) => state.choose);
  const importPlan = usePlanStore((state) => state.importPlan);
  const updatePlanPrefs = usePlanStore((state) => state.updatePlanPrefs);
  const activePlan = React.useMemo(
    () => activePlanFromState({ plans, activePlanId }),
    [activePlanId, plans],
  );
  const generatorPrefs = activePlan.prefs.generator ?? createDefaultGeneratorPrefs();
  const [term, setTerm] = React.useState<Term>("fall");
  const [panelOpen, setPanelOpen] = React.useState(true);
  const [blockoutMode, setBlockoutMode] = React.useState(false);
  const [selectedCourseKey, setSelectedCourseKey] = React.useState<string | null>(null);
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
    return map;
  }, [catalog]);
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
  const termData = React.useMemo(
    () => ({
      fall: buildTermBlocks(visibleSelections, "fall", { preview: Boolean(previewCandidate) }),
      winter: buildTermBlocks(visibleSelections, "winter", { preview: Boolean(previewCandidate) }),
    }),
    [previewCandidate, visibleSelections],
  );
  const creditTotals = React.useMemo(
    () => computeCreditTotals(activePlan, coursesByKey),
    [activePlan, coursesByKey],
  );
  const hasConflicts = TERMS.some((entry) =>
    termData[entry].blocks.some((block) => block.conflict),
  );
  const tightTransferLink = React.useMemo(
    () => findTightTransferLink(visibleSelections),
    [visibleSelections],
  );
  const selectedCourse = selectedCourseKey ? coursesByKey.get(selectedCourseKey) ?? null : null;
  const blockedWindows = React.useMemo(
    () => blockedWindowsFromRules(generatorPrefs.rules),
    [generatorPrefs.rules],
  );

  function setGeneratorPrefs(updater: (prefs: GeneratorPrefs) => GeneratorPrefs) {
    updatePlanPrefs(activePlan.id, (prefs) => ({
      ...prefs,
      generator: updater(prefs.generator ?? createDefaultGeneratorPrefs()),
    }));
  }

  function setRules(rules: RuleConfig[]) {
    setGeneratorPrefs((prefs) => ({ ...prefs, rules }));
  }

  function setSort(sort: GeneratorSortKey) {
    setGeneratorPrefs((prefs) => ({ ...prefs, sort }));
  }

  function toggleLockedCourse(courseKeyValue: string) {
    setGeneratorPrefs((prefs) => {
      const locked = new Set(prefs.lockedCourseKeys);

      if (locked.has(courseKeyValue)) {
        locked.delete(courseKeyValue);
      } else {
        locked.add(courseKeyValue);
      }

      return {
        ...prefs,
        lockedCourseKeys: [...locked].sort(),
      };
    });
  }

  function toggleBlockoutMode() {
    if (!blockoutMode) {
      setRules(ensureBlockedTimesRule(generatorPrefs.rules));
    }

    setBlockoutMode((current) => !current);
  }

  function paintBlockedCell(day: DayNumber, startMillis: number, endMillis: number) {
    setRules(toggleBlockedCell(generatorPrefs.rules, day, startMillis, endMillis));
  }

  function runGenerator() {
    const courses = buildGeneratorCourseInputs(
      activePlan,
      coursesByKey,
      generatorPrefs.lockedCourseKeys,
    );

    if (courses.length === 0) {
      setWorkerState("error");
      setWorkerError("Pin at least one course before generating.");
      setGenerationResult(null);
      return;
    }

    workerRef.current?.terminate();
    const request: GeneratorWorkerRequest = {
      type: "generate",
      id: createRequestId(),
      courses,
      config: {
        rules: generatorPrefs.rules,
        maxResults: 12,
        maxCombinations: 500_000,
        buildings: buildingCoordinates,
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
        headers: { "Content-Type": "application/json" },
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
    } catch (error) {
      setShareError(error instanceof Error ? error.message : String(error));
      setShareOpen(true);
    } finally {
      setSharing(false);
    }
  }

  function exportPlanJson() {
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
  }

  function exportIcs() {
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
      <main className="flex h-screen min-h-[720px] flex-col bg-background text-foreground">
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
          className="grid min-h-0 flex-1 border-t"
          style={{
            gridTemplateColumns: panelOpen
              ? "minmax(0,1fr) minmax(340px,390px)"
              : "minmax(0,1fr) 44px",
          }}
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
              {hasConflicts && (
                <Banner tone="error">
                  Conflicts detected. Overlapping blocks are outlined in red.
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
              activePlan={activePlan}
              courses={activeCourses}
              prefs={generatorPrefs}
              rules={generatorPrefs.rules}
              blockedWindows={blockedWindows}
              blockoutMode={blockoutMode}
              workerState={workerState}
              workerError={workerError}
              result={generationResult}
              sort={generatorPrefs.sort}
              onClose={() => setPanelOpen(false)}
              onRun={runGenerator}
              onRulesChange={setRules}
              onToggleBlockout={toggleBlockoutMode}
              onToggleLockedCourse={toggleLockedCourse}
              onPreviewCandidate={setPreviewCandidate}
              onSortChange={setSort}
            />
          ) : (
            <aside className="flex items-start justify-center border-l bg-background p-2">
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

        <CourseDetailSheet
          course={selectedCourse}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedCourseKey(null);
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
            <h1 className="truncate text-base font-semibold">better-ttb</h1>
            <p className="truncate text-xs text-muted-foreground">Timetable</p>
          </div>
        </div>

        <nav className="hidden items-center rounded-md bg-muted p-1 md:flex">
          <NavTab to="/" label="Build" />
          <NavTab to="/timetable" label="Timetable" icon={<CalendarDays className="size-3.5" />} />
          <NavTab to="/map" label="Map" icon={<MapIcon className="size-3.5" />} />
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Select value={activePlan.id} onValueChange={onSetActivePlan}>
          <SelectTrigger className="w-[170px]">
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
            </div>
          </PopoverContent>
        </Popover>

        <Button type="button" variant="outline" size="sm" onClick={onExportIcs}>
          <Download />
          ICS
        </Button>
        <Button type="button" size="sm" onClick={onShare} disabled={sharing}>
          <Share2 />
          Share
        </Button>
      </div>
    </header>
  );
}

function NavTab({
  to,
  label,
  icon,
}: {
  to: "/" | "/timetable" | "/map";
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      activeProps={{ className: "bg-background text-foreground shadow-xs" }}
      className="inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      {icon}
      {label}
    </Link>
  );
}

function GeneratePanel({
  activePlan,
  courses,
  prefs,
  rules,
  blockedWindows,
  blockoutMode,
  workerState,
  workerError,
  result,
  sort,
  onClose,
  onRun,
  onRulesChange,
  onToggleBlockout,
  onToggleLockedCourse,
  onPreviewCandidate,
  onSortChange,
}: {
  activePlan: Plan;
  courses: Course[];
  prefs: GeneratorPrefs;
  rules: RuleConfig[];
  blockedWindows: BlockedWindow[];
  blockoutMode: boolean;
  workerState: "idle" | "running" | "done" | "error";
  workerError: string | null;
  result: GenerationResult | null;
  sort: GeneratorSortKey;
  onClose: () => void;
  onRun: () => void;
  onRulesChange: (rules: RuleConfig[]) => void;
  onToggleBlockout: () => void;
  onToggleLockedCourse: (courseKey: string) => void;
  onPreviewCandidate: (candidate: CandidateTimetable) => void;
  onSortChange: (sort: GeneratorSortKey) => void;
}) {
  const sortedCandidates = React.useMemo(
    () => sortCandidates(result?.candidates ?? [], sort),
    [result?.candidates, sort],
  );

  return (
    <aside className="min-h-0 overflow-y-auto border-l bg-background">
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

      <div className="space-y-5 p-4">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Locked choices</h3>
            <Badge variant="outline">{prefs.lockedCourseKeys.length}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {courses.length === 0 ? (
              <p className="text-sm text-muted-foreground">Pin courses in Build first.</p>
            ) : (
              courses.map((course) => {
                const key = courseKey(course);
                const locked = prefs.lockedCourseKeys.includes(key);
                const pinned = activePlan.pinned.find((entry) => pinnedKey(entry) === key);
                const hasChoice = pinned
                  ? Object.values(pinned.chosen).some((choice) => Boolean(choice))
                  : false;

                return (
                  <Button
                    key={key}
                    type="button"
                    variant={locked ? "secondary" : "outline"}
                    size="xs"
                    onClick={() => onToggleLockedCourse(key)}
                    disabled={!hasChoice}
                  >
                    {locked ? <Lock /> : <Unlock />}
                    {course.code}
                  </Button>
                );
              })
            )}
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">Rules</h3>
              <p className="text-xs text-muted-foreground">{rules.length} active</p>
            </div>
            <Button
              type="button"
              variant={blockoutMode ? "secondary" : "outline"}
              size="sm"
              onClick={onToggleBlockout}
            >
              <Paintbrush />
              Block out
            </Button>
          </div>
          {blockoutMode && (
            <p className="rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Paint 30-minute cells on the grid. {blockedWindows.length} blocked windows are active.
            </p>
          )}
          <RuleEditor rules={rules} onRulesChange={onRulesChange} />
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Button type="button" className="w-full" onClick={onRun} disabled={workerState === "running"}>
              <Wand2 />
              {workerState === "running" ? "Generating" : "Run generator"}
            </Button>
          </div>
          {workerError && <p className="text-sm text-destructive">{workerError}</p>}
          {result?.infeasible && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-medium">No feasible timetable</p>
              <p className="mt-1 text-muted-foreground">{result.infeasible.reason}</p>
              {result.infeasible.conflictingCourses && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Check {result.infeasible.conflictingCourses.join(", ")}.
                </p>
              )}
            </div>
          )}
          {result && result.candidates.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{result.candidates.length} candidates</p>
                <Select value={sort} onValueChange={(value) => onSortChange(value as GeneratorSortKey)}>
                  <SelectTrigger size="sm" className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="score">Score</SelectItem>
                    <SelectItem value="walking">Walking</SelectItem>
                    <SelectItem value="earliest-start">Earliest start</SelectItem>
                    <SelectItem value="days-on-campus">Days on campus</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ResultsGallery
                plan={activePlan}
                courses={courses}
                candidates={sortedCandidates}
                onPreviewCandidate={onPreviewCandidate}
              />
              <p className="text-xs text-muted-foreground">
                Enumerated {result.stats.enumerated.toLocaleString()} combinations · {result.stats.exhaustive ? "exhaustive" : "budget capped"}
              </p>
            </>
          )}
        </section>
      </div>
    </aside>
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
                <p className="text-xs text-muted-foreground">{rule.kind}</p>
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

function ResultsGallery({
  plan,
  courses,
  candidates,
  onPreviewCandidate,
}: {
  plan: Plan;
  courses: Course[];
  candidates: CandidateTimetable[];
  onPreviewCandidate: (candidate: CandidateTimetable) => void;
}) {
  const coursesByKey = React.useMemo(
    () => new Map(courses.map((course) => [courseKey(course), course])),
    [courses],
  );

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {candidates.map((candidate, index) => {
        const selected = selectedSectionsFromCandidate(plan, coursesByKey, candidate);
        const fall = buildTermBlocks(selected, "fall", { preview: true });
        const winter = buildTermBlocks(selected, "winter", { preview: true });

        return (
          <div
            key={candidate.selections.map((selection) => `${selection.courseCode}:${selection.teachMethod}:${selection.sectionName}`).join("|")}
            role="button"
            tabIndex={0}
            className="w-[310px] shrink-0 cursor-pointer rounded-md border bg-background p-3 text-left shadow-xs outline-none transition-colors hover:bg-muted/30 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => onPreviewCandidate(candidate)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPreviewCandidate(candidate);
              }
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">Candidate {index + 1}</span>
              <Badge>{candidate.score.toFixed(1)}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1 text-[10px] font-medium text-muted-foreground">Fall</p>
                <WeekGrid blocks={fall.blocks} compact />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-medium text-muted-foreground">Winter</p>
                <WeekGrid blocks={winter.blocks} compact />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant="outline">{Math.round(totalWalkMinutes(candidate))} walk min</Badge>
              <Badge variant="outline">{daysOnCampusCount(candidate)} campus days</Badge>
              {candidate.metrics.slice(0, 2).map((metric) => (
                <Badge key={metric.ruleId} variant="secondary" className="max-w-full truncate">
                  {metric.detail}
                </Badge>
              ))}
            </div>
          </div>
        );
      })}
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

function CourseDetailSheet({
  course,
  onOpenChange,
}: {
  course: Course | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={Boolean(course)} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-hidden p-0 sm:max-w-xl">
        {course && (
          <>
            <SheetHeader className="border-b p-5">
              <SheetTitle>{course.code}</SheetTitle>
              <SheetDescription>{course.name}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{course.sectionCode}</Badge>
                  <Badge variant="outline">{course.maxCredit.toFixed(1)} credit</Badge>
                  <Badge variant="outline">{formatSessionsLabel(course.sessions)}</Badge>
                </div>
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Section</th>
                        <th className="px-3 py-2 text-left font-medium">Meetings</th>
                        <th className="px-3 py-2 text-left font-medium">Seats</th>
                      </tr>
                    </thead>
                    <tbody>
                      {course.sections.map((section) => (
                        <tr key={section.name} className="border-t">
                          <td className="px-3 py-2 align-top font-medium">{section.name}</td>
                          <td className="px-3 py-2 align-top text-muted-foreground">
                            {section.meetingTimes.length > 0
                              ? section.meetingTimes
                                  .map(
                                    (meeting) =>
                                      `${formatDayShort(meeting.start.day)} ${millisofdayToHHMM(meeting.start.millisofday)}-${millisofdayToHHMM(meeting.end.millisofday)}`,
                                  )
                                  .join(", ")
                              : "TBA"}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {section.currentEnrolment}/{section.maxEnrolment}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
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
        tone === "warn" && "border-amber-400/50 bg-amber-50 text-amber-900",
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

function formatSessionsLabel(sessions: readonly string[]): string {
  return sessions.map(formatSessionCode).join(" + ");
}

function formatSessionCode(session: string): string {
  try {
    return formatSessionLabel(session);
  } catch {
    return session;
  }
}

function formatDayShort(day: DayNumber): string {
  return DAY_OPTIONS.find((option) => option.value === day)?.label ?? String(day);
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

function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
}
