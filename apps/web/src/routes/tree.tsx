import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import type { Course } from "@better-ttb/shared";
import {
  Check,
  ChevronsUpDown,
  Info,
  Network,
  Search,
} from "lucide-react";
import * as React from "react";

import { AppNav, MobileNav } from "@/components/app-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { EdgeKind, GraphNode, RequisiteGraph } from "@/lib/requisites/graph";
import { useRequisiteGraph, preferredOffering } from "@/lib/requisites/use-graph";
import { sanitizeHtml, stripHtml } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { useCatalogStore } from "@/stores/catalog";
import { activePlanFromState, usePlanStore } from "@/stores/plan";

// @xyflow/react + elkjs are heavy and browser-only; keep them in the /tree chunk
// and off the SSR path (mirrors the CampusMap lazy import in map.tsx).
const PrereqGraph = React.lazy(() =>
  import("@/components/tree/PrereqGraph").then((module) => ({
    default: module.PrereqGraph,
  })),
);

const DEPTH_OPTIONS = ["1", "2", "3", "All"] as const;
type DepthOption = (typeof DEPTH_OPTIONS)[number];

export interface TreeSearch {
  course?: string;
}

export const Route = createFileRoute("/tree")({
  validateSearch: (search: Record<string, unknown>): TreeSearch => {
    const course = typeof search.course === "string" ? search.course : undefined;

    return course ? { course } : {};
  },
  head: () => ({ meta: [{ title: "Prereqs · better-ttb" }] }),
  component: TreeRoute,
});

function TreeRoute() {
  const posthog = usePostHog();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const catalog = useCatalogStore((state) => state.catalog);
  const status = useCatalogStore((state) => state.status);
  const loadCatalog = useCatalogStore((state) => state.loadCatalog);
  const plans = usePlanStore((state) => state.plans);
  const activePlanId = usePlanStore((state) => state.activePlanId);
  const activePlan = React.useMemo(
    () => activePlanFromState({ plans, activePlanId }),
    [activePlanId, plans],
  );
  const activeSessionsKey = activePlan.sessions.join(",");

  React.useEffect(() => {
    void loadCatalog(activePlan.sessions);
  }, [activePlan.sessions, activeSessionsKey, loadCatalog]);

  const graph = useRequisiteGraph(catalog?.courses);

  const [depth, setDepth] = React.useState<DepthOption>("2");
  const [showCoreq, setShowCoreq] = React.useState(true);
  const [showRecprep, setShowRecprep] = React.useState(false);

  const focusCode = search.course ?? null;

  const setFocus = React.useCallback(
    (code: string) => {
      void navigate({ search: { course: code }, replace: false });
    },
    [navigate],
  );

  const kinds = React.useMemo<EdgeKind[]>(() => {
    const list: EdgeKind[] = ["prereq"];

    if (showCoreq) {
      list.push("coreq");
    }
    if (showRecprep) {
      list.push("recprep");
    }
    return list;
  }, [showCoreq, showRecprep]);

  const depthValue =
    depth === "All" ? Number.POSITIVE_INFINITY : Number(depth);

  const focusNode = focusCode ? graph?.nodes.get(focusCode) ?? null : null;
  const focusFound = Boolean(focusNode?.inCatalog);

  React.useEffect(() => {
    if (focusCode && focusFound) {
      posthog.capture("prereq_tree_course_focused", {
        course_code: focusCode,
      });
    }
  }, [focusCode, focusFound, posthog]);

  return (
    <main className="flex h-screen min-h-[640px] flex-col bg-background text-foreground">
      <TreeHeader />

      <div className="flex flex-wrap items-center gap-3 border-t px-4 py-3">
        <CoursePicker graph={graph} value={focusCode} onSelect={setFocus} />

        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Depth</span>
          <Select value={depth} onValueChange={(value) => setDepth(value as DepthOption)}>
            <SelectTrigger className="h-9 w-20" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DEPTH_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Switch checked={showCoreq} onCheckedChange={setShowCoreq} size="sm" />
          Corequisites
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Switch checked={showRecprep} onCheckedChange={setShowRecprep} size="sm" />
          Recommended prep
        </label>

        <div className="ml-auto">
          <LegendPopover />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(240px,1fr)_auto] border-t pb-16 md:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] md:grid-rows-1 md:pb-0">
        <section className="relative min-h-0">
          <TreeCanvas
            graph={graph}
            status={status}
            focusCode={focusCode}
            focusFound={focusFound}
            depth={depthValue}
            kinds={kinds}
            onFocusCourse={setFocus}
          />
        </section>

        <FocusPanel
          graph={graph}
          focusCode={focusCode}
          focusFound={focusFound}
          onFocusCourse={setFocus}
        />
      </div>

      <MobileNav />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Canvas + empty states
// ---------------------------------------------------------------------------

function TreeCanvas({
  graph,
  status,
  focusCode,
  focusFound,
  depth,
  kinds,
  onFocusCourse,
}: {
  graph: RequisiteGraph | null;
  status: string;
  focusCode: string | null;
  focusFound: boolean;
  depth: number;
  kinds: EdgeKind[];
  onFocusCourse: (code: string) => void;
}) {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  if (status === "loading" || (!graph && status !== "empty" && status !== "error")) {
    return (
      <div className="flex h-full w-full flex-col gap-3 p-6">
        <Skeleton className="h-16 w-56" />
        <Skeleton className="ml-24 h-8 w-16" />
        <Skeleton className="h-16 w-56" />
        <Skeleton className="mt-8 h-16 w-56 self-center" />
      </div>
    );
  }

  if (!focusCode) {
    return (
      <CenteredCard>
        <Network className="size-8 text-muted-foreground" />
        <h2 className="mt-3 text-base font-semibold">Explore prerequisite trees</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Pick a course to explore its prerequisite tree. Try{" "}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-2"
            onClick={() => onFocusCourse("CSC318H1")}
          >
            CSC318H1
          </button>
          .
        </p>
      </CenteredCard>
    );
  }

  if (graph && !focusFound) {
    return (
      <CenteredCard>
        <h2 className="text-base font-semibold">Course not found</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{focusCode}</span> isn&apos;t
          in the loaded Arts &amp; Science catalog for this plan&apos;s sessions.
        </p>
      </CenteredCard>
    );
  }

  if (!graph) {
    return null;
  }

  const hasNeighbors =
    (graph.edgesTo.get(focusCode)?.length ?? 0) > 0 ||
    (graph.edgesFrom.get(focusCode)?.length ?? 0) > 0;

  if (!hasNeighbors) {
    return (
      <CenteredCard>
        <h2 className="text-base font-semibold">No connections</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{focusCode}</span> has no
          prerequisites and nothing else lists it as a requirement.
        </p>
      </CenteredCard>
    );
  }

  if (!mounted) {
    return <div className="h-full w-full bg-background" />;
  }

  return (
    <React.Suspense fallback={<div className="h-full w-full bg-background" />}>
      <PrereqGraph
        graph={graph}
        focusCode={focusCode}
        depth={depth}
        kinds={kinds}
        onFocusCourse={onFocusCourse}
      />
    </React.Suspense>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center rounded-lg border bg-card p-8 text-center text-card-foreground shadow-sm">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Course picker
// ---------------------------------------------------------------------------

interface PickerEntry {
  code: string;
  name: string;
}

function CoursePicker({
  graph,
  value,
  onSelect,
}: {
  graph: RequisiteGraph | null;
  value: string | null;
  onSelect: (code: string) => void;
}) {
  const [open, setOpen] = React.useState(false);

  const entries = React.useMemo<PickerEntry[]>(() => {
    if (!graph) {
      return [];
    }

    const list: PickerEntry[] = [];

    for (const node of graph.nodes.values()) {
      if (!node.inCatalog) {
        continue;
      }

      const offering = preferredOffering(node.offerings);

      list.push({ code: node.code, name: offering?.name ?? node.code });
    }

    return list.sort((left, right) => left.code.localeCompare(right.code));
  }, [graph]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-9 w-64 justify-between font-normal"
          disabled={!graph}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Search className="size-3.5 shrink-0 opacity-60" />
            <span className="truncate">{value ?? "Search a course…"}</span>
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0">
        <Command
          filter={(itemValue, searchTerm) =>
            itemValue.toLowerCase().includes(searchTerm.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder="Search by code or name…" />
          <CommandList>
            <CommandEmpty>No courses match.</CommandEmpty>
            <CommandGroup>
              {entries.map((entry) => (
                <CommandItem
                  key={entry.code}
                  value={`${entry.code} ${entry.name}`}
                  onSelect={() => {
                    onSelect(entry.code);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === entry.code ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{entry.code}</span>
                    <span className="text-muted-foreground"> — {entry.name}</span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function LegendPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5">
          <Info className="size-3.5" />
          Legend
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-xs">
        <p className="mb-2 font-semibold">Edges</p>
        <div className="space-y-2">
          <LegendLine dash={null} label="Prerequisite" />
          <LegendLine dash="6 4" label="Corequisite" />
          <LegendLine dash="2 4" dim label="Recommended prep" />
        </div>
        <Separator className="my-3" />
        <p className="mb-2 font-semibold">Gates</p>
        <div className="flex flex-wrap gap-1.5">
          <GateChip label="ALL" />
          <GateChip label="1 of" />
          <GateChip label="n of" />
        </div>
        <Separator className="my-3" />
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="inline-block h-4 w-6 rounded border border-dashed opacity-40" />
          Dimmed = not in Arts &amp; Science catalog
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LegendLine({
  dash,
  dim,
  label,
}: {
  dash: string | null;
  dim?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <svg width="28" height="8" className={cn(dim && "opacity-60")}>
        <line
          x1="0"
          y1="4"
          x2="28"
          y2="4"
          stroke="var(--muted-foreground)"
          strokeWidth="1.5"
          strokeDasharray={dash ?? undefined}
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}

function GateChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Focus panel
// ---------------------------------------------------------------------------

function FocusPanel({
  graph,
  focusCode,
  focusFound,
  onFocusCourse,
}: {
  graph: RequisiteGraph | null;
  focusCode: string | null;
  focusFound: boolean;
  onFocusCourse: (code: string) => void;
}) {
  const node = focusCode ? graph?.nodes.get(focusCode) ?? null : null;

  if (!graph || !focusCode || !node || !focusFound) {
    return (
      <aside className="hidden min-h-0 overflow-y-auto border-t bg-background md:block md:border-t-0 md:border-l">
        <div className="p-4 text-sm text-muted-foreground">
          Select a course to see its details.
        </div>
      </aside>
    );
  }

  const offering = preferredOffering(node.offerings);
  const info = offering?.cmCourseInfo ?? null;
  const description = info?.description ? firstSentences(stripHtml(info.description), 2) : null;

  const requiresCount = new Set(
    (graph.edgesTo.get(focusCode) ?? []).map((edge) => edge.from),
  ).size;
  const requiredByCount = new Set(
    (graph.edgesFrom.get(focusCode) ?? []).map((edge) => edge.to),
  ).size;

  const prereq = node.requisites.prereq;
  const noneConfidence = prereq?.confidence === "none";
  const notes = collectNotes(node.requisites);

  return (
    <aside className="min-h-0 overflow-y-auto border-t bg-background md:border-t-0 md:border-l">
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{focusCode}</h2>
              {offering?.sectionCode && (
                <Badge variant="secondary">{offering.sectionCode}</Badge>
              )}
              <CreditBadge offering={offering} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{offering?.name ?? focusCode}</p>
          </div>

          {description && (
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
          )}

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">Requires {requiresCount} courses</Badge>
            <Badge variant="outline">Required by {requiredByCount} courses</Badge>
          </div>

          {noneConfidence && prereq && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                Prerequisites (unparsed)
              </p>
              <div
                className="prose-sm text-sm leading-relaxed text-muted-foreground [&_a]:text-foreground [&_a]:underline"
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(info?.prerequisitesText),
                }}
              />
            </div>
          )}

          {notes.length > 0 && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              {notes.map((note, index) => (
                <p key={index} className={cn(index > 0 && "mt-1.5")}>
                  {note}
                </p>
              ))}
            </div>
          )}

          {node.exclusions.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase text-muted-foreground">
                Exclusions
              </p>
              <div className="flex flex-wrap gap-1.5">
                {node.exclusions.map((code) => {
                  const inCatalog = graph.nodes.get(code)?.inCatalog ?? false;

                  return (
                    <button
                      key={code}
                      type="button"
                      disabled={!inCatalog}
                      onClick={() => inCatalog && onFocusCourse(code)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-medium",
                        inCatalog
                          ? "cursor-pointer hover:border-ring"
                          : "cursor-default text-muted-foreground opacity-50",
                      )}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <Button asChild variant="outline" size="sm" className="w-full">
            <Link to="/" search={{ course: focusCode }}>
              Open course sheet
            </Link>
          </Button>
        </div>
      </ScrollArea>
    </aside>
  );
}

function CreditBadge({ offering }: { offering: Course | null }) {
  const credit = offering ? offering.maxCredit ?? offering.minCredit : null;

  if (typeof credit !== "number" || Number.isNaN(credit)) {
    return null;
  }

  return <Badge variant="outline">{credit.toFixed(1)} credit</Badge>;
}

function collectNotes(requisites: GraphNode["requisites"]): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();

  for (const kind of ["prereq", "coreq", "recprep"] as EdgeKind[]) {
    const parsed = requisites[kind];

    if (!parsed) {
      continue;
    }

    for (const note of parsed.notes) {
      if (!seen.has(note)) {
        seen.add(note);
        notes.push(note);
      }
    }
  }

  return notes;
}

function firstSentences(text: string, count: number): string {
  if (!text) {
    return "";
  }

  const matches = text.match(/[^.!?]+[.!?]+/g);

  if (!matches || matches.length === 0) {
    return text;
  }

  return matches.slice(0, count).join(" ").trim();
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function TreeHeader() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-4">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Network className="size-4" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">better-ttb</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">Prereqs</p>
          </div>
        </div>

        <AppNav />
      </div>
      <ThemeToggle />
    </header>
  );
}
