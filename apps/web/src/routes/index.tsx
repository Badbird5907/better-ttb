import { createFileRoute } from "@tanstack/react-router";
import { detectConflicts } from "@better-ttb/generator";
import type {
  Course,
  DayNumber,
  DeliveryMode,
  MeetingTime,
  Section,
  SectionCode,
  TeachMethod,
  TtbCourseLookupResponse,
} from "@better-ttb/shared";
import {
  formatDay,
  formatSessionLabel,
  millisofdayToHHMM,
  parseSessionCode,
} from "@better-ttb/shared";
import {
  Check,
  ChevronsUpDown,
  Copy,
  Filter,
  Layers,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import * as React from "react";

import buildings from "@/data/buildings.json";
import { AppNav, MobileNav } from "@/components/app-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DAY_FILTERS,
  DEFAULT_SEARCH_FILTERS,
  DELIVERY_MODE_LABELS,
  type CourseSearchFilters,
  createCourseSearch,
  getCourseBreadthCodes,
  getCourseDeliveryModes,
  hasActiveFilters,
  hasAvailableSpace,
  isWaitlistable,
  searchCourses,
} from "@/lib/search";
import { sanitizeHtml } from "@/lib/sanitize";
import {
  sectionConflictsWithPlan,
  type PlanSelectedSection,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
import { useCatalogStore } from "@/stores/catalog";
import {
  DEFAULT_PLAN_SESSIONS,
  activePlanFromState,
  type PinnedCourse,
  type Plan,
  usePlanStore,
} from "@/stores/plan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Search · better-ttb" }] }),
  component: Home,
});

const RESULT_ROW_HEIGHT = 124;
const RESULT_OVERSCAN = 5;

interface BuildingRecord {
  code: string;
  name: string;
  shortName: string;
  address: string;
  lat: number;
  lng: number;
  source: string;
}

type Term = "fall" | "winter";
type ArrayFilterKey =
  | "departments"
  | "levels"
  | "sectionCodes"
  | "deliveryModes"
  | "creditWeights"
  | "breadthCodes"
  | "days";

const buildingByCode = new Map(
  (buildings as BuildingRecord[]).map((building) => [building.code, building]),
);

function Home() {
  const status = useCatalogStore((state) => state.status);
  const catalog = useCatalogStore((state) => state.catalog);
  const error = useCatalogStore((state) => state.error);
  const departments = useCatalogStore((state) => state.departments);
  const levels = useCatalogStore((state) => state.levels);
  const loadCatalog = useCatalogStore((state) => state.loadCatalog);
  const plans = usePlanStore((state) => state.plans);
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const setActivePlan = usePlanStore((state) => state.setActivePlan);
  const setPlanSessions = usePlanStore((state) => state.setPlanSessions);
  const pinCourse = usePlanStore((state) => state.pin);
  const unpinCourse = usePlanStore((state) => state.unpin);
  const choose = usePlanStore((state) => state.choose);
  const clearChoice = usePlanStore((state) => state.clearChoice);
  const renamePlan = usePlanStore((state) => state.renamePlan);
  const newPlan = usePlanStore((state) => state.newPlan);
  const deletePlan = usePlanStore((state) => state.deletePlan);
  const duplicatePlan = usePlanStore((state) => state.duplicatePlan);
  const activePlan = React.useMemo(
    () => activePlanFromState({ plans, activePlanId }),
    [activePlanId, plans],
  );
  const activeSessionsKey = activePlan.sessions.join(",");
  const [query, setQuery] = React.useState("");
  const debouncedQuery = useDebouncedValue(query, 100);
  const [filters, setFilters] =
    React.useState<CourseSearchFilters>(DEFAULT_SEARCH_FILTERS);
  const [selectedCourseKey, setSelectedCourseKey] = React.useState<string | null>(
    null,
  );
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [mobileTab, setMobileTab] = React.useState<"search" | "pinned">("search");
  const [liveCourses, setLiveCourses] = React.useState<Map<string, Course>>(
    () => new Map(),
  );
  const [refreshingCourseKey, setRefreshingCourseKey] = React.useState<
    string | null
  >(null);
  const [refreshError, setRefreshError] = React.useState<string | null>(null);
  const [referenceSessions, setReferenceSessions] = React.useState<string[][]>(
    [],
  );

  React.useEffect(() => {
    void loadCatalog(activePlan.sessions);
  }, [activeSessionsKey, activePlan.sessions, loadCatalog]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadReferenceData() {
      try {
        const response = await fetch("/api/reference-data");

        if (!response.ok) {
          return;
        }

        const body = (await response.json()) as unknown;
        const sessions = extractSessionOptions(body);

        if (!cancelled) {
          setReferenceSessions(sessions);
        }
      } catch {
        if (!cancelled) {
          setReferenceSessions([]);
        }
      }
    }

    void loadReferenceData();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key !== "/" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isTextInput(event.target)
      ) {
        return;
      }

      event.preventDefault();
      document.querySelector<HTMLInputElement>("[data-course-search]")?.focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const searchIndex = React.useMemo(
    () => (catalog ? createCourseSearch(catalog.courses) : null),
    [catalog],
  );
  const coursesByKey = React.useMemo(() => {
    const map = new Map<string, Course>();

    catalog?.courses.forEach((course) => map.set(courseKey(course), course));
    liveCourses.forEach((course, key) => map.set(key, course));

    return map;
  }, [catalog, liveCourses]);
  const results = React.useMemo(
    () =>
      searchIndex
        ? searchCourses(searchIndex, debouncedQuery, filters)
        : ([] satisfies Course[]),
    [debouncedQuery, filters, searchIndex],
  );

  React.useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery, filters]);
  const breadthOptions = React.useMemo(() => {
    const breadths = new Set<string>();

    catalog?.courses.forEach((course) => {
      getCourseBreadthCodes(course).forEach((breadth) => breadths.add(breadth));
    });

    return [...breadths].sort(compareBreadthCodes);
  }, [catalog]);
  const creditOptions = React.useMemo(() => {
    const credits = new Set<number>();

    catalog?.courses.forEach((course) => credits.add(course.maxCredit));
    return [...credits].sort((left, right) => left - right);
  }, [catalog]);
  const selectedCourse = selectedCourseKey
    ? coursesByKey.get(selectedCourseKey) ?? null
    : null;
  const planSelectedSections = React.useMemo(
    () => collectPlanSelectedSections(activePlan, coursesByKey),
    [activePlan, coursesByKey],
  );
  const sessionOptions = React.useMemo(
    () =>
      mergeSessionOptions([
        catalog?.sessions,
        activePlan.sessions,
        DEFAULT_PLAN_SESSIONS,
        ...referenceSessions,
      ]),
    [activePlan.sessions, catalog?.sessions, referenceSessions],
  );

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

  function toggleArrayFilter(key: ArrayFilterKey, value: string | number) {
    setFilters((current) => {
      switch (key) {
        case "departments":
          return {
            ...current,
            departments: toggleValue(current.departments, String(value)),
          };
        case "levels":
          return {
            ...current,
            levels: toggleValue(current.levels, String(value)),
          };
        case "sectionCodes":
          return {
            ...current,
            sectionCodes: toggleValue(
              current.sectionCodes,
              String(value) as SectionCode,
            ),
          };
        case "deliveryModes":
          return {
            ...current,
            deliveryModes: toggleValue(
              current.deliveryModes,
              String(value) as DeliveryMode,
            ),
          };
        case "creditWeights":
          return {
            ...current,
            creditWeights: toggleValue(current.creditWeights, Number(value)),
          };
        case "breadthCodes":
          return {
            ...current,
            breadthCodes: toggleValue(current.breadthCodes, String(value)),
          };
        case "days":
          return {
            ...current,
            days: toggleValue(current.days, Number(value) as DayNumber),
          };
      }
    });
  }

  function togglePinCourse(course: Course) {
    if (isCoursePinned(activePlan, course.code, course.sectionCode)) {
      unpinCourse(course.code, course.sectionCode);
    } else {
      pinCourse(course.code, course.sectionCode);
    }
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      // stop cmdk's root handler from also acting on arrow keys.
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((current) => Math.min(current + 1, results.length - 1));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    const activeCourse = results[activeIndex];

    if (event.key === "Enter" && activeCourse) {
      event.preventDefault();
      event.stopPropagation();
      setSelectedCourseKey(courseKey(activeCourse));
      return;
    }

    if ((event.key === "p" || event.key === "P") && activeCourse) {
      event.preventDefault();
      event.stopPropagation();
      togglePinCourse(activeCourse);
    }
  }

  return (
    <TooltipProvider>
      <main className="flex h-screen min-h-[720px] flex-col bg-background text-foreground">
        <BuilderHeader
          activePlan={activePlan}
          plans={plans}
          sessionOptions={sessionOptions}
          onSessionChange={setPlanSessions}
          onSetActivePlan={setActivePlan}
          onNewPlan={() => newPlan(activePlan.sessions)}
          onRenamePlan={() => {
            const nextName = window.prompt("Rename plan", activePlan.name);

            if (nextName !== null) {
              renamePlan(activePlan.id, nextName);
            }
          }}
          onDuplicatePlan={() => duplicatePlan(activePlan.id)}
          onDeletePlan={() => {
            if (plans.length > 1 && window.confirm(`Delete ${activePlan.name}?`)) {
              deletePlan(activePlan.id);
            }
          }}
        />

        <div className="border-t p-1 lg:hidden">
          <Tabs
            value={mobileTab}
            onValueChange={(value) => setMobileTab(value as "search" | "pinned")}
          >
            <TabsList className="w-full">
              <TabsTrigger value="search" className="flex-1">
                Search
              </TabsTrigger>
              <TabsTrigger value="pinned" className="flex-1">
                Pinned
                <Badge variant="secondary">{activePlan.pinned.length}</Badge>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {status === "empty" ? (
          <CatalogEmptyState />
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 border-t pb-16 md:pb-0 lg:grid-cols-[minmax(440px,1fr)_420px] xl:grid-cols-[minmax(560px,1fr)_460px]">
            <section
              className={cn(
                "min-h-0 grid-rows-[auto_minmax(0,1fr)] border-r bg-muted/20 lg:grid",
                mobileTab === "search" ? "grid" : "hidden lg:grid",
              )}
            >
              <SearchPanel
                query={query}
                filters={filters}
                departments={departments}
                levels={levels}
                breadthOptions={breadthOptions}
                creditOptions={creditOptions}
                onQueryChange={setQuery}
                onSearchKeyDown={handleSearchKeyDown}
                onClearFilters={() => setFilters(DEFAULT_SEARCH_FILTERS)}
                onToggleArrayFilter={toggleArrayFilter}
                onInstructorChange={(instructor) =>
                  setFilters((current) => ({ ...current, instructor }))
                }
                onBooleanFilterChange={(key, value) =>
                  setFilters((current) => ({ ...current, [key]: value }))
                }
              />
              <CourseResults
                status={status}
                error={error}
                catalogTotal={catalog?.total ?? 0}
                results={results}
                activePlan={activePlan}
                activeIndex={activeIndex}
                onRetry={() => void loadCatalog(activePlan.sessions)}
                onOpenCourse={(course) => setSelectedCourseKey(courseKey(course))}
                onPinCourse={(course) => pinCourse(course.code, course.sectionCode)}
                onUnpinCourse={(course) =>
                  unpinCourse(course.code, course.sectionCode)
                }
              />
            </section>

            <PlanPanel
              plan={activePlan}
              coursesByKey={coursesByKey}
              planSelectedSections={planSelectedSections}
              className={cn(mobileTab === "pinned" ? "flex" : "hidden lg:flex")}
              onChoose={choose}
              onClearChoice={clearChoice}
              onUnpin={unpinCourse}
              onOpenCourse={(pinned) =>
                setSelectedCourseKey(pinnedKey(pinned))
              }
            />
          </div>
        )}

        <CourseDetailSheet
          course={selectedCourse}
          activePlan={activePlan}
          planSelectedSections={planSelectedSections}
          refreshError={refreshError}
          refreshing={selectedCourseKey === refreshingCourseKey}
          pinned={
            selectedCourse
              ? isCoursePinned(activePlan, selectedCourse.code, selectedCourse.sectionCode)
              : false
          }
          onChoose={choose}
          onClearChoice={clearChoice}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedCourseKey(null);
              setRefreshError(null);
              document
                .querySelector<HTMLInputElement>("[data-course-search]")
                ?.focus();
            }
          }}
          onPin={(course) => pinCourse(course.code, course.sectionCode)}
          onUnpin={(course) => unpinCourse(course.code, course.sectionCode)}
          onRefresh={refreshSeats}
        />

        <MobileNav />
      </main>
    </TooltipProvider>
  );
}

function BuilderHeader({
  activePlan,
  plans,
  sessionOptions,
  onSessionChange,
  onSetActivePlan,
  onNewPlan,
  onRenamePlan,
  onDuplicatePlan,
  onDeletePlan,
}: {
  activePlan: Plan;
  plans: Plan[];
  sessionOptions: string[][];
  onSessionChange: (sessions: string[]) => void;
  onSetActivePlan: (planId: string) => void;
  onNewPlan: () => void;
  onRenamePlan: () => void;
  onDuplicatePlan: () => void;
  onDeletePlan: () => void;
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
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              UofT Arts & Science timetable builder
            </p>
          </div>
        </div>

        <AppNav />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Select
          value={activePlan.sessions.join(",")}
          onValueChange={(value) => onSessionChange(value.split(","))}
        >
          <SelectTrigger className="hidden w-[210px] md:flex">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sessionOptions.map((sessions) => (
              <SelectItem key={sessions.join(",")} value={sessions.join(",")}>
                {formatSessionsLabel(sessions)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={activePlan.id} onValueChange={onSetActivePlan}>
          <SelectTrigger className="w-[110px] min-w-0 sm:w-[160px]">
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

        <HeaderIconButton
          label="New plan"
          onClick={onNewPlan}
          className="hidden sm:inline-flex"
        >
          <Plus />
        </HeaderIconButton>
        <HeaderIconButton
          label="Rename plan"
          onClick={onRenamePlan}
          className="hidden sm:inline-flex"
        >
          <Pencil />
        </HeaderIconButton>
        <HeaderIconButton
          label="Duplicate plan"
          onClick={onDuplicatePlan}
          className="hidden sm:inline-flex"
        >
          <Copy />
        </HeaderIconButton>
        <HeaderIconButton
          label="Delete plan"
          onClick={onDeletePlan}
          disabled={plans.length <= 1}
          className="hidden sm:inline-flex"
        >
          <Trash2 />
        </HeaderIconButton>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="sm:hidden"
            >
              <MoreHorizontal />
              <span className="sr-only">Plan actions</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1.5">
            <div className="space-y-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={onNewPlan}
              >
                <Plus />
                New plan
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={onRenamePlan}
              >
                <Pencil />
                Rename plan
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={onDuplicatePlan}
              >
                <Copy />
                Duplicate plan
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={onDeletePlan}
                disabled={plans.length <= 1}
              >
                <Trash2 />
                Delete plan
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <ThemeToggle />
      </div>
    </header>
  );
}

function HeaderIconButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" {...props}>
          {children}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SearchPanel({
  query,
  filters,
  departments,
  levels,
  breadthOptions,
  creditOptions,
  onQueryChange,
  onSearchKeyDown,
  onClearFilters,
  onToggleArrayFilter,
  onInstructorChange,
  onBooleanFilterChange,
}: {
  query: string;
  filters: CourseSearchFilters;
  departments: Array<{ value: string; label: string; count: number }>;
  levels: string[];
  breadthOptions: string[];
  creditOptions: number[];
  onQueryChange: (query: string) => void;
  onSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onClearFilters: () => void;
  onToggleArrayFilter: (key: ArrayFilterKey, value: string | number) => void;
  onInstructorChange: (value: string) => void;
  onBooleanFilterChange: (
    key: "availableSpace" | "waitlistable",
    value: boolean,
  ) => void;
}) {
  const activeFilterCount = countActiveFilters(filters);

  return (
    <div className="space-y-3 border-b bg-background p-4">
      <Command className="h-11 rounded-md border shadow-xs">
        <CommandInput
          autoFocus
          data-course-search
          value={query}
          onValueChange={onQueryChange}
          onKeyDown={onSearchKeyDown}
          placeholder="Search code, title, description"
          className="h-11"
        />
      </Command>

      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label="Departments" count={filters.departments.length}>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {departments.slice(0, 80).map((department) => (
              <CheckRow
                key={department.value}
                label={department.label}
                detail={String(department.count)}
                checked={filters.departments.includes(department.value)}
                onCheckedChange={() =>
                  onToggleArrayFilter("departments", department.value)
                }
              />
            ))}
          </div>
        </FilterChip>

        <FilterChip label="Level" count={filters.levels.length}>
          <div className="grid grid-cols-2 gap-2">
            {levels.map((level) => (
              <CheckRow
                key={level}
                label={`${level}-level`}
                checked={filters.levels.includes(level)}
                onCheckedChange={() => onToggleArrayFilter("levels", level)}
              />
            ))}
          </div>
        </FilterChip>

        <FilterChip
          label="Offering"
          count={
            filters.sectionCodes.length +
            filters.deliveryModes.length +
            filters.creditWeights.length
          }
        >
          <FilterGroup title="Term">
            {(["F", "S", "Y"] as const).map((sectionCode) => (
              <CheckRow
                key={sectionCode}
                label={sectionCodeLabel(sectionCode)}
                checked={filters.sectionCodes.includes(sectionCode)}
                onCheckedChange={() =>
                  onToggleArrayFilter("sectionCodes", sectionCode)
                }
              />
            ))}
          </FilterGroup>
          <FilterGroup title="Delivery">
            {(Object.keys(DELIVERY_MODE_LABELS) as DeliveryMode[]).map((mode) => (
              <CheckRow
                key={mode}
                label={DELIVERY_MODE_LABELS[mode]}
                checked={filters.deliveryModes.includes(mode)}
                onCheckedChange={() => onToggleArrayFilter("deliveryModes", mode)}
              />
            ))}
          </FilterGroup>
          <FilterGroup title="Credit">
            {creditOptions.map((credit) => (
              <CheckRow
                key={credit}
                label={`${credit.toFixed(1)} credit`}
                checked={filters.creditWeights.includes(credit)}
                onCheckedChange={() => onToggleArrayFilter("creditWeights", credit)}
              />
            ))}
          </FilterGroup>
        </FilterChip>

        <FilterChip label="Requirements" count={filters.breadthCodes.length}>
          <div className="grid grid-cols-2 gap-2">
            {breadthOptions.map((breadth) => (
              <CheckRow
                key={breadth}
                label={formatBreadth(breadth)}
                checked={filters.breadthCodes.includes(breadth)}
                onCheckedChange={() => onToggleArrayFilter("breadthCodes", breadth)}
              />
            ))}
          </div>
        </FilterChip>

        <FilterChip
          label="Schedule"
          count={
            filters.days.length +
            (filters.availableSpace ? 1 : 0) +
            (filters.waitlistable ? 1 : 0) +
            (filters.instructor.trim() ? 1 : 0)
          }
        >
          <FilterGroup title="Days with meetings">
            <div className="grid grid-cols-2 gap-2">
              {DAY_FILTERS.map((day) => (
                <CheckRow
                  key={day.value}
                  label={day.label}
                  checked={filters.days.includes(day.value)}
                  onCheckedChange={() => onToggleArrayFilter("days", day.value)}
                />
              ))}
            </div>
          </FilterGroup>
          <FilterGroup title="Instructor">
            <Input
              value={filters.instructor}
              onChange={(event) => onInstructorChange(event.target.value)}
              placeholder="Name contains"
            />
          </FilterGroup>
          <div className="space-y-3 pt-2">
            <SwitchRow
              label="Available space"
              checked={filters.availableSpace}
              onCheckedChange={(checked) =>
                onBooleanFilterChange("availableSpace", checked)
              }
            />
            <SwitchRow
              label="Waitlistable"
              checked={filters.waitlistable}
              onCheckedChange={(checked) =>
                onBooleanFilterChange("waitlistable", checked)
              }
            />
          </div>
        </FilterChip>

        {hasActiveFilters(filters) && (
          <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}>
            <X className="size-3.5" />
            Clear {activeFilterCount}
          </Button>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant={count > 0 ? "secondary" : "outline"} size="sm">
          <Filter className="size-3.5" />
          {label}
          {count > 0 && <Badge variant="outline">{count}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        {children}
      </PopoverContent>
    </Popover>
  );
}

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 py-2 first:pt-0 last:pb-0">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function CheckRow({
  label,
  detail,
  checked,
  onCheckedChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  onCheckedChange: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-accent",
        checked && "bg-accent text-accent-foreground",
      )}
      onClick={onCheckedChange}
    >
      <span className="truncate">{label}</span>
      {detail && <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>}
    </button>
  );
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function CourseResults({
  status,
  error,
  catalogTotal,
  results,
  activePlan,
  activeIndex,
  onRetry,
  onOpenCourse,
  onPinCourse,
  onUnpinCourse,
}: {
  status: string;
  error: string | null;
  catalogTotal: number;
  results: Course[];
  activePlan: Plan;
  activeIndex: number;
  onRetry: () => void;
  onOpenCourse: (course: Course) => void;
  onPinCourse: (course: Course) => void;
  onUnpinCourse: (course: Course) => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / RESULT_ROW_HEIGHT) - RESULT_OVERSCAN,
  );
  const visibleCount = 16 + RESULT_OVERSCAN * 2;
  const visibleCourses = results.slice(startIndex, startIndex + visibleCount);

  // Keep the keyboard-highlighted row within the scroll viewport.
  React.useEffect(() => {
    const container = scrollRef.current;

    if (!container || results.length === 0) {
      return;
    }

    const rowTop = activeIndex * RESULT_ROW_HEIGHT;
    const rowBottom = rowTop + RESULT_ROW_HEIGHT;

    if (rowTop < container.scrollTop) {
      container.scrollTop = rowTop;
    } else if (rowBottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = rowBottom - container.clientHeight;
    }
  }, [activeIndex, results.length]);

  if (status === "loading" || status === "idle") {
    return <CourseResultsSkeleton />;
  }

  if (status === "error") {
    return (
      <div className="p-4">
        <InlineError
          message={error ?? "Catalog could not be loaded."}
          onRetry={onRetry}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-11 items-center justify-between border-b bg-background px-4 text-sm">
        <span className="font-medium">{results.length.toLocaleString()} courses</span>
        <span className="text-muted-foreground">
          {catalogTotal.toLocaleString()} catalog entries
        </span>
      </div>
      {results.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
          No courses match the current search.
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div
            className="relative"
            style={{ height: results.length * RESULT_ROW_HEIGHT }}
          >
            <div
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${startIndex * RESULT_ROW_HEIGHT}px)` }}
            >
              {visibleCourses.map((course, offset) => {
                const pinned = isCoursePinned(
                  activePlan,
                  course.code,
                  course.sectionCode,
                );

                return (
                  <CourseResultRow
                    key={courseKey(course)}
                    course={course}
                    pinned={pinned}
                    active={startIndex + offset === activeIndex}
                    onOpen={() => onOpenCourse(course)}
                    onPin={() => onPinCourse(course)}
                    onUnpin={() => onUnpinCourse(course)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CourseResultRow({
  course,
  pinned,
  active,
  onOpen,
  onPin,
  onUnpin,
}: {
  course: Course;
  pinned: boolean;
  active: boolean;
  onOpen: () => void;
  onPin: () => void;
  onUnpin: () => void;
}) {
  const breadths = getCourseBreadthCodes(course);
  const full = course.primaryFull || !hasAvailableSpace(course);
  const waitlistable = isWaitlistable(course);

  return (
    <div className="h-[124px] px-3 py-2">
      <button
        type="button"
        onClick={onOpen}
        aria-current={active}
        className={cn(
          "grid h-full w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border bg-background p-3 text-left shadow-xs transition-colors hover:border-ring/60 hover:bg-accent/40",
          active && "border-ring ring-[3px] ring-ring/50 bg-accent/40",
        )}
      >
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-semibold">{course.code}</span>
            <SectionBadge sectionCode={course.sectionCode} />
            <span className="truncate text-sm text-muted-foreground">{course.department.code}</span>
          </div>
          <p className="truncate text-sm font-medium">{course.name}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{course.maxCredit.toFixed(1)} credit</Badge>
            {breadths.slice(0, 3).map((breadth) => (
              <Badge key={breadth} variant="secondary">
                {formatBreadth(breadth)}
              </Badge>
            ))}
            {full && <Badge variant="destructive">Full</Badge>}
            {waitlistable && <Badge variant="outline">Waitlist</Badge>}
          </div>
        </div>
        <Button
          type="button"
          variant={pinned ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={(event) => {
            event.stopPropagation();
            if (pinned) {
              onUnpin();
            } else {
              onPin();
            }
          }}
        >
          {pinned ? <PinOff /> : <Pin />}
          <span className="sr-only">{pinned ? "Unpin course" : "Pin course"}</span>
        </Button>
      </button>
    </div>
  );
}

function PlanPanel({
  plan,
  coursesByKey,
  planSelectedSections,
  className,
  onChoose,
  onClearChoice,
  onUnpin,
  onOpenCourse,
}: {
  plan: Plan;
  coursesByKey: Map<string, Course>;
  planSelectedSections: readonly PlanSelectedSection[];
  className?: string;
  onChoose: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
    sectionName: string,
  ) => void;
  onClearChoice: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
  ) => void;
  onUnpin: (courseCode: string, sectionCode: SectionCode) => void;
  onOpenCourse: (pinned: PinnedCourse) => void;
}) {
  const conflictKeys = React.useMemo(
    () => detectPlanConflictKeys(plan, coursesByKey),
    [coursesByKey, plan],
  );
  const credits = React.useMemo(
    () => computeCreditTotals(plan, coursesByKey),
    [coursesByKey, plan],
  );

  return (
    <aside className={cn("min-h-0 flex-col bg-background", className)}>
      <div className="space-y-3 border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Pinned courses</h2>
            <p className="text-xs text-muted-foreground">
              {plan.pinned.length} selected for {plan.name}
            </p>
          </div>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border text-center text-xs">
            <div className="px-3 py-1.5">
              <div className="font-semibold">{credits.fall.toFixed(1)}</div>
              <div className="text-muted-foreground">Fall</div>
            </div>
            <div className="border-l px-3 py-1.5">
              <div className="font-semibold">{credits.winter.toFixed(1)}</div>
              <div className="text-muted-foreground">Winter</div>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {plan.pinned.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Pin courses from the search results to start choosing sections.
          </div>
        ) : (
          <div className="space-y-3">
            {plan.pinned.map((pinned) => (
              <PinnedCourseCard
                key={pinnedKey(pinned)}
                pinned={pinned}
                course={coursesByKey.get(pinnedKey(pinned)) ?? null}
                conflictKeys={conflictKeys}
                planSelectedSections={planSelectedSections}
                onChoose={onChoose}
                onClearChoice={onClearChoice}
                onUnpin={onUnpin}
                onOpenCourse={onOpenCourse}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function PinnedCourseCard({
  pinned,
  course,
  conflictKeys,
  planSelectedSections,
  onChoose,
  onClearChoice,
  onUnpin,
  onOpenCourse,
}: {
  pinned: PinnedCourse;
  course: Course | null;
  conflictKeys: Set<string>;
  planSelectedSections: readonly PlanSelectedSection[];
  onChoose: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
    sectionName: string,
  ) => void;
  onClearChoice: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
  ) => void;
  onUnpin: (courseCode: string, sectionCode: SectionCode) => void;
  onOpenCourse: (pinned: PinnedCourse) => void;
}) {
  const teachMethods = course ? getTeachMethods(course.sections) : [];
  const courseKeyValue = pinnedKey(pinned);

  return (
    <Card className="gap-4 rounded-md py-4 shadow-xs">
      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-3 px-4">
        <button
          type="button"
          className="min-w-0 space-y-1 text-left"
          onClick={() => onOpenCourse(pinned)}
        >
          <CardTitle className="truncate text-sm hover:underline">
            {pinned.courseCode} <SectionBadge sectionCode={pinned.sectionCode} />
          </CardTitle>
          <p className="truncate text-xs text-muted-foreground">
            {course?.name ?? "Not found in loaded catalog"}
          </p>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={(event) => {
            event.stopPropagation();
            onUnpin(pinned.courseCode, pinned.sectionCode);
          }}
        >
          <X />
          <span className="sr-only">Unpin</span>
        </Button>
      </CardHeader>
      {course && (
        <CardContent className="space-y-3 px-4">
          {teachMethods.map((teachMethod) => {
            const selected = pinned.chosen[teachMethod] ?? null;
            const selectedSection = selected
              ? course.sections.find(
                  (section) =>
                    section.teachMethod === teachMethod && section.name === selected,
                )
              : undefined;
            const conflictKey = selectedSection
              ? selectedConflictKey(pinned, selectedSection)
              : null;
            const hasConflict = conflictKey ? conflictKeys.has(conflictKey) : false;
            const sections = course.sections.filter(
              (section) => section.teachMethod === teachMethod,
            );

            return (
              <div key={teachMethod} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium">{teachMethod}</span>
                  {hasConflict && (
                    <span className="text-destructive">Conflict</span>
                  )}
                </div>
                <SectionCombobox
                  sections={sections}
                  value={selected}
                  hasConflict={hasConflict}
                  conflictOf={(section) =>
                    // Compare against the whole plan, including this course's
                    // OTHER teach-method choices (a TUT can clash with your own
                    // chosen LEC) — but never against this method's own slot.
                    sectionConflictsWithPlan(
                      section,
                      pinned.sectionCode,
                      "",
                      planSelectedSections.filter(
                        (entry) =>
                          !(
                            entry.courseKey === courseKeyValue &&
                            entry.teachMethod === teachMethod
                          ),
                      ),
                    )
                  }
                  onChoose={(sectionName) =>
                    onChoose(
                      pinned.courseCode,
                      pinned.sectionCode,
                      teachMethod,
                      sectionName,
                    )
                  }
                  onClear={() =>
                    onClearChoice(pinned.courseCode, pinned.sectionCode, teachMethod)
                  }
                />
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}

function SectionCombobox({
  sections,
  value,
  hasConflict,
  conflictOf,
  onChoose,
  onClear,
}: {
  sections: readonly Section[];
  value: string | null;
  hasConflict: boolean;
  conflictOf: (section: Section) => PlanSelectedSection | null;
  onChoose: (sectionName: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const selectedSection = value
    ? sections.find((section) => section.name === value) ?? null
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-auto min-h-9 w-full justify-between whitespace-normal py-2 text-left font-normal",
            hasConflict &&
              "border-destructive text-destructive ring-destructive/20",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="min-w-0 flex-1 truncate">
            {selectedSection
              ? formatSectionOption(selectedSection)
              : "Auto — let generator choose"}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <Command>
          <CommandInput placeholder="Filter sections..." />
          <CommandList>
            <CommandEmpty>No sections match.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__auto__ Auto let generator choose"
                onSelect={() => {
                  onClear();
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 size-4",
                    value ? "opacity-0" : "opacity-100",
                  )}
                />
                Auto — let generator choose
              </CommandItem>
              {sections.map((section) => {
                const cancelled = section.cancelInd === "Y";
                const conflict = cancelled ? null : conflictOf(section);

                return (
                  <CommandItem
                    key={section.name}
                    value={`${section.name} ${formatSectionOption(section)}`}
                    disabled={cancelled}
                    onSelect={() => {
                      onChoose(section.name);
                      setOpen(false);
                    }}
                    className={cn(conflict && "text-destructive")}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        value === section.name ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      {formatSectionOption(section)}
                      {conflict && (
                        <span className="ml-1 font-medium">(conflicts)</span>
                      )}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CourseDetailSheet({
  course,
  activePlan,
  planSelectedSections,
  refreshError,
  refreshing,
  pinned,
  onChoose,
  onClearChoice,
  onOpenChange,
  onPin,
  onUnpin,
  onRefresh,
}: {
  course: Course | null;
  activePlan: Plan;
  planSelectedSections: readonly PlanSelectedSection[];
  refreshError: string | null;
  refreshing: boolean;
  pinned: boolean;
  onChoose: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
    sectionName: string,
  ) => void;
  onClearChoice: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
  ) => void;
  onOpenChange: (open: boolean) => void;
  onPin: (course: Course) => void;
  onUnpin: (course: Course) => void;
  onRefresh: (course: Course) => void;
}) {
  const chosenForCourse = course
    ? activePlan.pinned.find(
        (entry) =>
          entry.courseCode === course.code &&
          entry.sectionCode === course.sectionCode,
      )?.chosen ?? {}
    : {};
  return (
    <Sheet open={course !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-hidden p-0 sm:max-w-3xl">
        {course && (
          <>
            <SheetHeader className="border-b p-5 pr-14">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <SheetTitle className="text-xl">{course.code}</SheetTitle>
                    <SectionBadge sectionCode={course.sectionCode} />
                    <Badge variant="outline">{course.maxCredit.toFixed(1)} credit</Badge>
                  </div>
                  <SheetDescription className="text-base text-foreground">
                    {course.name}
                  </SheetDescription>
                  <p className="text-sm text-muted-foreground">
                    {course.department.name}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1 sm:flex-none"
                    onClick={() => onRefresh(course)}
                    disabled={refreshing}
                  >
                    <RefreshCw className={cn(refreshing && "animate-spin")} />
                    Refresh seats
                  </Button>
                  <Button
                    type="button"
                    variant={pinned ? "secondary" : "default"}
                    size="sm"
                    className="flex-1 sm:flex-none"
                    onClick={() => (pinned ? onUnpin(course) : onPin(course))}
                  >
                    {pinned ? <PinOff /> : <Pin />}
                    {pinned ? "Pinned" : "Pin"}
                  </Button>
                </div>
              </div>
              {refreshError && <p className="text-sm text-destructive">{refreshError}</p>}
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <CourseDetailBody
                course={course}
                chosen={chosenForCourse}
                planSelectedSections={planSelectedSections}
                onChoose={onChoose}
                onClearChoice={onClearChoice}
              />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CourseDetailBody({
  course,
  chosen,
  planSelectedSections,
  onChoose,
  onClearChoice,
}: {
  course: Course;
  chosen: Record<TeachMethod, string | null>;
  planSelectedSections: readonly PlanSelectedSection[];
  onChoose: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
    sectionName: string,
  ) => void;
  onClearChoice: (
    courseCode: string,
    sectionCode: SectionCode,
    teachMethod: TeachMethod,
  ) => void;
}) {
  const info = course.cmCourseInfo;
  const breadths = getCourseBreadthCodes(course);
  const groupedSections = groupSectionsByTeachMethod(course.sections);
  const courseKeyValue = courseKey(course);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Description</h3>
        <div
          className="prose prose-sm max-w-none text-sm leading-6 text-muted-foreground [&_a]:text-primary [&_li]:ml-4 [&_ul]:list-disc"
          dangerouslySetInnerHTML={{
            __html:
              sanitizeHtml(info?.description ?? null) ||
              "<p>No course description is available.</p>",
          }}
        />
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <RequirementBlock title="Prerequisites" html={info?.prerequisitesText ?? null} />
        <RequirementBlock title="Corequisites" html={info?.corequisitesText ?? null} />
        <RequirementBlock title="Exclusions" html={info?.exclusionsText ?? null} />
        <RequirementBlock
          title="Recommended preparation"
          html={info?.recommendedPreparation ?? null}
        />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Breadth</h3>
        <div className="flex flex-wrap gap-1.5">
          {breadths.length > 0 ? (
            breadths.map((breadth) => (
              <Badge key={breadth} variant="secondary">
                {formatBreadth(breadth)}
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">No breadth listed</span>
          )}
        </div>
      </section>

      {course.notes.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Notes</h3>
          <div className="space-y-2">
            {course.notes.map((note, index) => (
              <div
                key={`${note.name}-${index}`}
                className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(note.content) }}
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Sections</h3>
        {groupedSections.map(([teachMethod, sections]) => (
          <div key={teachMethod} className="overflow-hidden rounded-md border">
            <div className="border-b bg-muted/50 px-3 py-2 text-sm font-medium">
              {teachMethod}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2 text-left font-medium">Pin</th>
                    <th className="px-3 py-2 text-left font-medium">Section</th>
                    <th className="px-3 py-2 text-left font-medium">Meetings</th>
                    <th className="px-3 py-2 text-left font-medium">Instructor</th>
                    <th className="px-3 py-2 text-left font-medium">Seats</th>
                    <th className="px-3 py-2 text-left font-medium">Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.map((section) => {
                    const isChosen = (chosen[teachMethod] ?? null) === section.name;
                    const conflict = sectionConflictsWithPlan(
                      section,
                      course.sectionCode,
                      courseKeyValue,
                      planSelectedSections,
                    );

                    return (
                      <SectionRow
                        key={section.name}
                        section={section}
                        chosen={isChosen}
                        conflict={conflict}
                        onToggle={() => {
                          if (isChosen) {
                            onClearChoice(
                              course.code,
                              course.sectionCode,
                              teachMethod,
                            );
                          } else {
                            onChoose(
                              course.code,
                              course.sectionCode,
                              teachMethod,
                              section.name,
                            );
                          }
                        }}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function RequirementBlock({
  title,
  html,
}: {
  title: string;
  html: string | null;
}) {
  const sanitized = sanitizeHtml(html);

  return (
    <section className="rounded-md border p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {sanitized ? (
        <div
          className="text-sm leading-6 text-muted-foreground [&_a]:text-primary"
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">None listed</p>
      )}
    </section>
  );
}

function SectionRow({
  section,
  chosen,
  conflict,
  onToggle,
}: {
  section: Section;
  chosen: boolean;
  conflict: PlanSelectedSection | null;
  onToggle: () => void;
}) {
  const cancelled = section.cancelInd === "Y";

  return (
    <tr
      className={cn(
        "border-t",
        cancelled && "text-muted-foreground line-through",
        chosen && "bg-primary/5",
        conflict && !chosen && "bg-destructive/5",
      )}
    >
      <td className="px-3 py-3 align-top">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={chosen ? "secondary" : "ghost"}
              size="icon-xs"
              disabled={cancelled}
              onClick={onToggle}
            >
              {chosen ? <PinOff /> : <Pin />}
              <span className="sr-only">
                {chosen ? "Clear choice (back to Auto)" : "Pin this section"}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {chosen ? "Clear choice — back to Auto" : "Pin course and choose this section"}
          </TooltipContent>
        </Tooltip>
      </td>
      <td className="px-3 py-3 align-top font-medium">
        <div className="space-y-1">
          <span>{section.name}</span>
          {conflict && (
            <div className="text-xs font-normal text-destructive no-underline">
              Conflicts with {conflict.courseCode} {conflict.section.name}
            </div>
          )}
        </div>
      </td>
      <td className="max-w-[280px] px-3 py-3 align-top">
        {section.meetingTimes.length > 0 ? (
          <div className="space-y-1">
            {section.meetingTimes.map((meeting, index) => (
              <div key={`${section.name}-${index}`}>
                <span>{formatMeetingTime(meeting)}</span>
                <span className="mx-1 text-muted-foreground">·</span>
                <BuildingLocation meeting={meeting} />
              </div>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">TBA</span>
        )}
      </td>
      <td className="px-3 py-3 align-top">{formatInstructors(section)}</td>
      <td className="px-3 py-3 align-top">
        <div className="space-y-1">
          <span>
            {section.currentEnrolment}/{section.maxEnrolment}
          </span>
          {section.currentWaitlist > 0 && (
            <div className="text-xs text-muted-foreground">
              {section.currentWaitlist} waitlisted
            </div>
          )}
        </div>
      </td>
      <td className="px-3 py-3 align-top">
        <div className="flex flex-wrap gap-1">
          {getSectionDeliveryModes(section).map((mode) => (
            <Badge key={mode} variant="outline">
              {DELIVERY_MODE_LABELS[mode]}
            </Badge>
          ))}
        </div>
      </td>
    </tr>
  );
}

function BuildingLocation({ meeting }: { meeting: MeetingTime }) {
  const buildingCode = meeting.building.buildingCode;
  const room = formatRoom(meeting);
  const building = buildingByCode.get(buildingCode);
  const label = buildingCode ? `${buildingCode}${room}` : "TBA";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="underline decoration-dotted underline-offset-2">{label}</span>
      </TooltipTrigger>
      <TooltipContent>
        {building?.name ?? meeting.building.buildingName ?? buildingCode}
      </TooltipContent>
    </Tooltip>
  );
}

function SectionBadge({ sectionCode }: { sectionCode: SectionCode }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent",
        sectionCode === "F" &&
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
        sectionCode === "S" &&
          "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
        sectionCode === "Y" &&
          "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300",
      )}
    >
      {sectionCode}
    </Badge>
  );
}

function CatalogEmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center border-t p-8">
      <div className="max-w-md rounded-md border border-dashed p-8 text-center">
        <h2 className="text-lg font-semibold">Catalog not scraped yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Run <span className="font-mono">POST /api/admin/scrape</span> to build the
          cached catalog artifact.
        </p>
      </div>
    </div>
  );
}

function CourseResultsSkeleton() {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-11 items-center justify-between border-b bg-background px-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="space-y-2 overflow-hidden p-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="rounded-md border bg-background p-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-8" />
            </div>
            <Skeleton className="mt-2 h-4 w-3/4" />
            <div className="mt-2 flex gap-1.5">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-12" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InlineError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-medium text-destructive">Something went wrong</p>
        <p className="text-muted-foreground break-words">{message}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw />
          Retry
        </Button>
      </div>
    </div>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebounced(value), delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debounced;
}

function isTextInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function isCoursePinned(
  plan: Plan,
  courseCode: string,
  sectionCode: SectionCode,
): boolean {
  return plan.pinned.some(
    (pinned) =>
      pinned.courseCode === courseCode && pinned.sectionCode === sectionCode,
  );
}

function courseKey(course: Course): string {
  return `${course.code}:${course.sectionCode}`;
}

function pinnedKey(pinned: PinnedCourse): string {
  return `${pinned.courseCode}:${pinned.sectionCode}`;
}

function selectedConflictKey(pinned: PinnedCourse, section: Section): string {
  return `${pinnedKey(pinned)}:${section.teachMethod}:${section.name}`;
}

function formatSessionsLabel(sessions: string[]): string {
  return sessions.map(formatSessionCode).join(" + ");
}

function formatSessionCode(session: string): string {
  try {
    return formatSessionLabel(session);
  } catch {
    return session;
  }
}

function mergeSessionOptions(options: Array<string[] | undefined>): string[][] {
  const seen = new Set<string>();
  const merged: string[][] = [];

  options.forEach((option) => {
    if (!option || option.length === 0) {
      return;
    }

    const normalized = option
      .map((session) => session.trim())
      .filter((session) => session.length > 0);
    const key = normalized.join(",");

    if (normalized.length > 0 && !seen.has(key)) {
      seen.add(key);
      merged.push(normalized);
    }
  });

  return merged;
}

function extractSessionOptions(value: unknown): string[][] {
  const sessions = new Set<string>();
  collectSessionCodes(value, sessions);

  return [...sessions]
    .sort()
    .map((session) => [session])
    .filter((session) => session[0] !== undefined);
}

function collectSessionCodes(value: unknown, sessions: Set<string>): void {
  if (typeof value === "string") {
    if (/^\d{5}(?:-\d{5})?$/.test(value)) {
      sessions.add(value);
    }

    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectSessionCodes(entry, sessions));
    return;
  }

  if (isRecord(value)) {
    Object.values(value).forEach((entry) => collectSessionCodes(entry, sessions));
  }
}

function countActiveFilters(filters: CourseSearchFilters): number {
  return (
    filters.departments.length +
    filters.levels.length +
    filters.sectionCodes.length +
    filters.deliveryModes.length +
    filters.creditWeights.length +
    filters.breadthCodes.length +
    filters.days.length +
    (filters.instructor.trim() ? 1 : 0) +
    (filters.availableSpace ? 1 : 0) +
    (filters.waitlistable ? 1 : 0)
  );
}

function toggleValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function sectionCodeLabel(sectionCode: SectionCode): string {
  if (sectionCode === "F") {
    return "Fall";
  }

  if (sectionCode === "S") {
    return "Winter";
  }

  return "Year";
}

const BREADTH_NAMES: Record<string, string> = {
  "1": "Creative and Cultural Representations",
  "2": "Thought, Belief, and Behaviour",
  "3": "Society and Its Institutions",
  "4": "Living Things and Their Environment",
  "5": "The Physical and Mathematical Universes",
};

function formatBreadth(breadth: string): string {
  const match = breadth.match(/([1-5])$/);
  if (!match?.[1]) return breadth;
  const name = BREADTH_NAMES[match[1]];
  return name ? `BR ${match[1]}: ${name}` : `BR ${match[1]}`;
}

function compareBreadthCodes(left: string, right: string): number {
  return breadthRank(left) - breadthRank(right);
}

function breadthRank(value: string): number {
  const match = value.match(/([1-5])$/);
  return match?.[1] ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function groupSectionsByTeachMethod(
  sections: readonly Section[],
): Array<[TeachMethod, Section[]]> {
  const groups = new Map<TeachMethod, Section[]>();

  sections.forEach((section) => {
    groups.set(section.teachMethod, [
      ...(groups.get(section.teachMethod) ?? []),
      section,
    ]);
  });

  return [...groups.entries()].sort(([left], [right]) =>
    teachMethodRank(left) - teachMethodRank(right) || left.localeCompare(right),
  );
}

function getTeachMethods(sections: readonly Section[]): TeachMethod[] {
  return groupSectionsByTeachMethod(sections).map(([teachMethod]) => teachMethod);
}

function teachMethodRank(teachMethod: TeachMethod): number {
  if (teachMethod === "LEC") {
    return 0;
  }

  if (teachMethod === "TUT") {
    return 1;
  }

  if (teachMethod === "PRA") {
    return 2;
  }

  return 3;
}

function formatMeetingTime(meeting: MeetingTime): string {
  return `${formatDay(meeting.start.day)} ${millisofdayToHHMM(
    meeting.start.millisofday,
  )}-${millisofdayToHHMM(meeting.end.millisofday)}`;
}

function formatSectionOption(section: Section): string {
  const firstMeeting = section.meetingTimes[0];
  const meeting = firstMeeting ? formatMeetingTime(firstMeeting) : "TBA";
  const room = firstMeeting ? formatRoom(firstMeeting) : "";
  const building = firstMeeting?.building.buildingCode
    ? `${firstMeeting.building.buildingCode}${room}`
    : "TBA";

  return `${section.name} · ${meeting} · ${building} · ${section.currentEnrolment}/${section.maxEnrolment}`;
}

function formatRoom(meeting: MeetingTime): string {
  const number = meeting.building.buildingRoomNumber;
  const suffix = meeting.building.buildingRoomSuffix;

  return `${number}${suffix}`.trim();
}

function formatInstructors(section: Section): string {
  if (section.instructors.length === 0) {
    return "TBA";
  }

  return section.instructors
    .map((instructor) => `${instructor.firstName} ${instructor.lastName}`)
    .join(", ");
}

function getSectionDeliveryModes(section: Section): DeliveryMode[] {
  const modes = new Set<DeliveryMode>(
    section.deliveryModes.map((deliveryMode) => deliveryMode.mode),
  );

  if (section.tbaInd === "Y" || section.meetingTimes.length === 0) {
    modes.add("ASYNC");
  }

  return [...modes].sort();
}

function extractLiveCourse(
  response: TtbCourseLookupResponse,
  sectionCode: SectionCode,
): Course | null {
  const payload = response.payload;

  if (!payload) {
    return null;
  }

  const candidates = Array.isArray(payload)
    ? payload
    : isCourse(payload)
      ? [payload]
      : extractCoursesFromRecord(payload);

  return (
    candidates.find((course) => course.sectionCode === sectionCode) ??
    candidates[0] ??
    null
  );
}

function extractCoursesFromRecord(value: Record<string, unknown>): Course[] {
  const course = value.course;
  const courses = value.courses;

  if (isCourse(course)) {
    return [course];
  }

  if (Array.isArray(courses)) {
    return courses.filter(isCourse);
  }

  return [];
}

function isCourse(value: unknown): value is Course {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.sectionCode === "string" &&
    Array.isArray(value.sections)
  );
}

function mergeLiveEnrolment(base: Course, live: Course): Course {
  const liveSections = new Map(live.sections.map((section) => [section.name, section]));

  return {
    ...base,
    primaryFull: live.primaryFull,
    primaryWaitlistable: live.primaryWaitlistable,
    sections: base.sections.map((section) => {
      const liveSection = liveSections.get(section.name);

      if (!liveSection) {
        return section;
      }

      return {
        ...section,
        currentEnrolment: liveSection.currentEnrolment,
        maxEnrolment: liveSection.maxEnrolment,
        currentWaitlist: liveSection.currentWaitlist,
        waitlistInd: liveSection.waitlistInd,
        cancelInd: liveSection.cancelInd,
        enrolmentInd: liveSection.enrolmentInd,
        openLimitInd: liveSection.openLimitInd,
      };
    }),
  };
}

function detectPlanConflictKeys(
  plan: Plan,
  coursesByKey: Map<string, Course>,
): Set<string> {
  const selected = plan.pinned.flatMap((pinned) => {
    const course = coursesByKey.get(pinnedKey(pinned));

    if (!course) {
      return [];
    }

    return Object.entries(pinned.chosen).flatMap(([teachMethod, sectionName]) => {
      if (!sectionName) {
        return [];
      }

      const section = course.sections.find(
        (candidate) =>
          candidate.teachMethod === teachMethod && candidate.name === sectionName,
      );

      if (!section) {
        return [];
      }

      return [
        {
          pinned,
          section,
          course,
          key: selectedConflictKey(pinned, section),
        },
      ];
    });
  });
  const conflictKeys = new Set<string>();

  (["fall", "winter"] as const).forEach((term) => {
    const termSections = selected
      .filter((entry) => courseAppliesToTerm(entry.course.sectionCode, term))
      .map((entry) => ({
        key: entry.key,
        section: sectionForTerm(entry.section, term, entry.key),
      }))
      .filter((entry) => entry.section.meetingTimes.length > 0);
    const conflicts = detectConflicts(termSections.map((entry) => entry.section));

    conflicts.forEach((conflict) => {
      conflictKeys.add(conflict.first);
      conflictKeys.add(conflict.second);
    });
  });

  return conflictKeys;
}

function collectPlanSelectedSections(
  plan: Plan,
  coursesByKey: Map<string, Course>,
): PlanSelectedSection[] {
  return plan.pinned.flatMap((pinned) => {
    const course = coursesByKey.get(pinnedKey(pinned));

    if (!course) {
      return [];
    }

    return Object.entries(pinned.chosen).flatMap(([teachMethod, sectionName]) => {
      if (!sectionName) {
        return [];
      }

      const section = course.sections.find(
        (candidate) =>
          candidate.teachMethod === teachMethod && candidate.name === sectionName,
      );

      if (!section) {
        return [];
      }

      return [
        {
          courseKey: pinnedKey(pinned),
          courseCode: pinned.courseCode,
          sectionCode: pinned.sectionCode,
          teachMethod: teachMethod as TeachMethod,
          section,
        },
      ];
    });
  });
}

function sectionForTerm(section: Section, term: Term, key: string): Section {
  return {
    ...section,
    name: key,
    meetingTimes: section.meetingTimes.filter((meeting) =>
      meetingAppliesToTerm(meeting, term),
    ),
  };
}

function meetingAppliesToTerm(meeting: MeetingTime, term: Term): boolean {
  try {
    const parsed = parseSessionCode(meeting.sessionCode);
    return parsed.term === "year" || parsed.term === term;
  } catch {
    return true;
  }
}

function courseAppliesToTerm(sectionCode: SectionCode, term: Term): boolean {
  return (
    sectionCode === "Y" ||
    (sectionCode === "F" && term === "fall") ||
    (sectionCode === "S" && term === "winter")
  );
}

function computeCreditTotals(
  plan: Plan,
  coursesByKey: Map<string, Course>,
): { fall: number; winter: number } {
  return plan.pinned.reduce(
    (totals, pinned) => {
      const course = coursesByKey.get(pinnedKey(pinned));

      if (!course) {
        return totals;
      }

      if (course.sectionCode === "F") {
        return { ...totals, fall: totals.fall + course.maxCredit };
      }

      if (course.sectionCode === "S") {
        return { ...totals, winter: totals.winter + course.maxCredit };
      }

      return {
        fall: totals.fall + course.maxCredit / 2,
        winter: totals.winter + course.maxCredit / 2,
      };
    },
    { fall: 0, winter: 0 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
