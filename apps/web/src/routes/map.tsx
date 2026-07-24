import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Course, DayNumber } from "@better-ttb/shared";
import { formatDay, millisofdayToHHMM } from "@better-ttb/shared";
import { Footprints, Layers, MapPin, TriangleAlert } from "lucide-react";
import * as React from "react";

import { AppHeader } from "@/components/app-header";
import { MobileNav } from "@/components/app-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BUILDING_INDEX } from "@/lib/buildings";
import {
  buildDayItinerary,
  daysWithClasses,
  type DayItinerary,
  type ItineraryTransfer,
} from "@/lib/itinerary";
import {
  courseKey,
  findPlanSelectionIssues,
  selectedSectionsFromPlan,
  type Term,
} from "@/lib/timetable";
import { useCatalogForSessions } from "@/lib/use-catalog";
import { cn } from "@/lib/utils";
import { useCatalogStore } from "@/stores/catalog";
import { activePlanFromState, usePlanStore } from "@/stores/plan";

const TERMS: Term[] = ["fall", "winter"];
const SCHOOL_DAYS: DayNumber[] = [1, 2, 3, 4, 5];

// leaflet is heavy and browser-only: lazy import keeps it in the /map chunk and
// off the server-render path.
const CampusMap = React.lazy(() =>
  import("@/components/map/CampusMap").then((module) => ({ default: module.CampusMap })),
);

export interface MapSearch {
  term: Term;
  day: DayNumber;
}

export const Route = createFileRoute("/map")({
  validateSearch: (search: Record<string, unknown>): MapSearch => ({
    term: search.term === "winter" ? "winter" : "fall",
    day: normalizeDay(search.day),
  }),
  head: () => ({ meta: [{ title: "Map · better-ttb" }] }),
  component: MapRoute,
});

function normalizeDay(value: unknown): DayNumber {
  const day = Number(value);

  return day >= 1 && day <= 7 && Number.isInteger(day) ? (day as DayNumber) : 1;
}

function MapRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const catalog = useCatalogStore((state) => state.catalog);
  const plans = usePlanStore((state) => state.plans);
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const activePlan = React.useMemo(
    () => activePlanFromState({ plans, activePlanId }),
    [activePlanId, plans],
  );
  useCatalogForSessions(activePlan.sessions);

  const coursesByKey = React.useMemo(() => {
    const map = new Map<string, Course>();

    catalog?.courses.forEach((course) => map.set(courseKey(course), course));
    return map;
  }, [catalog]);
  const selectedSections = React.useMemo(
    () => selectedSectionsFromPlan(activePlan, coursesByKey),
    [activePlan, coursesByKey],
  );
  const planSelectionIssues = React.useMemo(
    () => findPlanSelectionIssues(activePlan, coursesByKey),
    [activePlan, coursesByKey],
  );

  const [hoveredTransferIndex, setHoveredTransferIndex] = React.useState<number | null>(null);

  const term = search.term;
  const day = search.day;

  const daysWithMeetings = React.useMemo(
    () => daysWithClasses(selectedSections, BUILDING_INDEX, term),
    [selectedSections, term],
  );
  // Mon–Fri always shown; weekend tabs appear only when meetings exist there.
  const dayOptions = React.useMemo(() => {
    const days = new Set<DayNumber>(SCHOOL_DAYS);
    daysWithMeetings.forEach((entry) => days.add(entry));
    return [...days].sort((left, right) => left - right);
  }, [daysWithMeetings]);

  const itinerary = React.useMemo(
    () => buildDayItinerary(selectedSections, BUILDING_INDEX, term, day),
    [day, selectedSections, term],
  );

  function setTerm(nextTerm: Term) {
    const nextDays = daysWithClasses(selectedSections, BUILDING_INDEX, nextTerm);
    const nextDay = nextDays.includes(day) ? day : nextDays[0] ?? 1;

    void navigate({ search: { term: nextTerm, day: nextDay } });
  }

  function setDay(nextDay: DayNumber) {
    void navigate({ search: { term, day: nextDay } });
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <AppHeader brandIcon={Layers} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <Tabs value={term} onValueChange={(value) => setTerm(value as Term)}>
          <TabsList>
            <TabsTrigger value="fall">Fall</TabsTrigger>
            <TabsTrigger value="winter">Winter</TabsTrigger>
          </TabsList>
        </Tabs>

        <Tabs value={String(day)} onValueChange={(value) => setDay(Number(value) as DayNumber)}>
          <TabsList>
            {dayOptions.map((option) => (
              <TabsTrigger key={option} value={String(option)}>
                {formatDay(option)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {planSelectionIssues.length > 0 && (
        <div className="border-t border-amber-400/50 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          Some saved sections are no longer available and are omitted from this map.
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(240px,1fr)_auto] border-t pb-16 md:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] md:grid-rows-1 md:pb-0">
        <section className="relative min-h-0">
          <MapCanvas itinerary={itinerary} hoveredTransferIndex={hoveredTransferIndex} />
          {itinerary.unknownLocations.length > 0 && (
            <div className="absolute bottom-3 left-3 z-[500] max-w-xs rounded-md border bg-background/95 p-2 text-xs shadow-sm">
              <p className="font-medium">No location for:</p>
              <p className="text-muted-foreground">
                {itinerary.unknownLocations
                  .map((entry) => `${entry.courseCode} ${entry.sectionName} (${entry.buildingCode})`)
                  .join(", ")}
              </p>
            </div>
          )}
        </section>

        <WalkPanel
          itinerary={itinerary}
          hoveredTransferIndex={hoveredTransferIndex}
          onHoverTransfer={setHoveredTransferIndex}
        />
      </div>

      <MobileNav />
    </main>
  );
}

function MapCanvas({
  itinerary,
  hoveredTransferIndex,
}: {
  itinerary: DayItinerary;
  hoveredTransferIndex: number | null;
}) {
  const [mounted, setMounted] = React.useState(false);

  // Render nothing during SSR / first paint; leaflet needs a real DOM + window.
  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="h-full w-full bg-background" />;
  }

  return (
    <React.Suspense fallback={<div className="h-full w-full bg-background" />}>
      <div className="relative h-full w-full bg-background">
        <CampusMap itinerary={itinerary} hoveredTransferIndex={hoveredTransferIndex} />
        {itinerary.markers.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
            <div className="rounded-md border bg-background/95 px-4 py-3 text-center text-sm text-muted-foreground shadow-sm">
              No in-person classes on this day
            </div>
          </div>
        )}
      </div>
    </React.Suspense>
  );
}

function WalkPanel({
  itinerary,
  hoveredTransferIndex,
  onHoverTransfer,
}: {
  itinerary: DayItinerary;
  hoveredTransferIndex: number | null;
  onHoverTransfer: (index: number | null) => void;
}) {
  return (
    <aside className="min-h-0 overflow-y-auto border-t bg-background md:border-t-0 md:border-l">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background p-4">
        <div>
          <h2 className="text-sm font-semibold">Walking route</h2>
          <p className="text-xs text-muted-foreground">
            {formatDay(itinerary.day)} · {itinerary.markers.length} stops
          </p>
        </div>
        <Badge variant="outline" className="gap-1">
          <Footprints className="size-3" />
          {Math.round(itinerary.totalWalkMinutes)} min
        </Badge>
      </div>

      <div className="space-y-3 p-4">
        {itinerary.transfers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No building-to-building transfers on this day.
          </p>
        ) : (
          itinerary.transfers.map((transfer, index) => (
            <TransferRow
              key={`${transfer.from.key}-${transfer.to.key}-${index}`}
              transfer={transfer}
              isHovered={hoveredTransferIndex === index}
              onMouseEnter={() => onHoverTransfer(index)}
              onMouseLeave={() => onHoverTransfer(null)}
              onFocus={() => onHoverTransfer(index)}
              onBlur={() => onHoverTransfer(null)}
            />
          ))
        )}
      </div>

      <p className="border-t px-4 py-3 text-[11px] text-muted-foreground">
        Walking routes © OSRM/OpenStreetMap
      </p>
    </aside>
  );
}

function TransferRow({
  transfer,
  isHovered,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}: {
  transfer: ItineraryTransfer;
  isHovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const tight = transfer.severity === "tight";
  const warn = transfer.severity === "warn";

  return (
    <div
      tabIndex={0}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      className={cn(
        "rounded-md border bg-background p-3 text-sm transition-colors",
        "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isHovered && "bg-muted/50",
        tight && "border-destructive/50 bg-destructive/5",
        warn && "border-amber-400/60 bg-amber-50 dark:bg-amber-500/10",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {transfer.from.courseCode} {transfer.from.sectionName} ({transfer.from.buildingCode})
          </p>
          <p className="text-xs text-muted-foreground">
            {millisofdayToHHMM(transfer.from.endMillis)} → {millisofdayToHHMM(transfer.to.startMillis)}
          </p>
          <p className="font-medium">
            {transfer.to.courseCode} {transfer.to.sectionName} ({transfer.to.buildingCode})
          </p>
        </div>
        <MapPin
          className={cn(
            "size-4 shrink-0 text-muted-foreground",
            tight && "text-destructive",
            warn && "text-amber-600 dark:text-amber-400",
          )}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary">
          {Math.round(transfer.gapMin) === 0
            ? // Back-to-back listed times still leave the 10-min UofT grace window.
              `gap ${Math.round(transfer.graceGapMin)} min (UofT time)`
            : `gap ${Math.round(transfer.gapMin)} min`}
        </Badge>
        <Badge variant="secondary">walk ~{Math.round(transfer.walkMin)} min</Badge>
        {tight && (
          <span className="inline-flex items-center gap-1 font-medium text-destructive">
            <TriangleAlert className="size-3.5" />
            not walkable in time
          </span>
        )}
        {warn && (
          <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
            <TriangleAlert className="size-3.5" />
            tight
          </span>
        )}
      </div>
    </div>
  );
}

