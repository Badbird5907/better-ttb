import type {
  CandidateTimetable,
  GenerationResult,
  RuleConfig,
} from "@better-ttb/generator";
import type { Course } from "@better-ttb/shared";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Footprints,
  Hourglass,
  Paintbrush,
  TriangleAlert,
  Wand2,
  X,
} from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WeekGrid } from "@/components/timetable/WeekGrid";
import type { BlockedWindow } from "@/components/timetable/WeekGrid";
import {
  candidateChips,
  scoreTone,
  type CandidateChip,
  type ScoreTone,
} from "@/lib/candidate-metrics";
import {
  buildTermBlocks,
  courseKey,
  selectedSectionsFromCandidate,
} from "@/lib/timetable";
import { cn } from "@/lib/utils";
import type { GeneratorSortKey, Plan } from "@/stores/plan";

export interface GeneratePanelContentProps {
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
  /** Read-only locked-choices hint (kept in the route to reuse plan helpers). */
  renderLockedChoices: () => React.ReactNode;
  /** The interactive rule editor (kept in the route to reuse its many controls). */
  renderRuleEditor: () => React.ReactNode;
  onRun: () => void;
  onToggleBlockout: () => void;
  onPreviewCandidate: (candidate: CandidateTimetable) => void;
  onApplyPreview: () => void;
  onDiscardPreview: () => void;
  onSortChange: (sort: GeneratorSortKey) => void;
}

export function candidateKey(candidate: CandidateTimetable): string {
  return candidate.selections
    .map((selection) => `${selection.courseCode}:${selection.teachMethod}:${selection.sectionName}`)
    .join("|");
}

/**
 * The scrollable body of the Generate panel. Rendered once and shared between the
 * desktop sidebar and the mobile drawer so behavior stays identical.
 */
export function GeneratePanelBody({
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
  renderLockedChoices,
  renderRuleEditor,
  onRun,
  onToggleBlockout,
  onPreviewCandidate,
  onApplyPreview,
  onDiscardPreview,
  onSortChange,
}: GeneratePanelContentProps) {
  return (
    <div className="space-y-5 p-4">
      {renderLockedChoices()}

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
          <p className="rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            Paint 30-minute cells on the grid. {blockedWindows.length} blocked windows are active.
          </p>
        )}
        {renderRuleEditor()}
      </section>

      <Separator />

      <section className="space-y-3">
        <Button type="button" className="w-full" onClick={onRun} disabled={workerState === "running"}>
          <Wand2 />
          {workerState === "running" ? "Generating" : "Run generator"}
        </Button>
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
            <CandidateList
              plan={activePlan}
              courses={courses}
              candidates={sortedCandidates}
              previewKey={previewKey}
              onPreviewCandidate={onPreviewCandidate}
              onApplyPreview={onApplyPreview}
              onDiscardPreview={onDiscardPreview}
            />
            <p className="text-xs text-muted-foreground">
              Enumerated {result.stats.enumerated.toLocaleString()} combinations · {result.stats.exhaustive ? "exhaustive" : "budget capped"}
            </p>
          </>
        )}
      </section>
    </div>
  );
}

const CHIP_ICONS: Record<CandidateChip["key"], React.ComponentType<{ className?: string }>> = {
  walk: Footprints,
  campus: CalendarDays,
  gap: Hourglass,
  waitlist: TriangleAlert,
};

const SCORE_TONE_CLASS: Record<ScoreTone, string> = {
  good: "border-transparent bg-emerald-600 text-white dark:bg-emerald-500",
  warn: "border-transparent bg-amber-500 text-amber-950 dark:bg-amber-400 dark:text-amber-950",
  muted: "border-transparent bg-muted text-muted-foreground",
};

function CandidateList({
  plan,
  courses,
  candidates,
  previewKey,
  onPreviewCandidate,
  onApplyPreview,
  onDiscardPreview,
}: {
  plan: Plan;
  courses: Course[];
  candidates: CandidateTimetable[];
  previewKey: string | null;
  onPreviewCandidate: (candidate: CandidateTimetable) => void;
  onApplyPreview: () => void;
  onDiscardPreview: () => void;
}) {
  const coursesByKey = React.useMemo(
    () => new Map(courses.map((course) => [courseKey(course), course])),
    [courses],
  );

  return (
    <ScrollArea className="max-h-[60vh]">
      <div className="flex flex-col gap-3 pr-3">
        {candidates.map((candidate, index) => (
          <CandidateCard
            key={candidateKey(candidate)}
            plan={plan}
            coursesByKey={coursesByKey}
            candidate={candidate}
            index={index}
            selected={previewKey === candidateKey(candidate)}
            onPreview={() => onPreviewCandidate(candidate)}
            onApply={onApplyPreview}
            onDiscard={onDiscardPreview}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function CandidateCard({
  plan,
  coursesByKey,
  candidate,
  index,
  selected,
  onPreview,
  onApply,
  onDiscard,
}: {
  plan: Plan;
  coursesByKey: Map<string, Course>;
  candidate: CandidateTimetable;
  index: number;
  selected: boolean;
  onPreview: () => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const selected_ = React.useMemo(
    () => selectedSectionsFromCandidate(plan, coursesByKey, candidate),
    [candidate, coursesByKey, plan],
  );
  const fall = React.useMemo(
    () => buildTermBlocks(selected_, "fall", { preview: true }),
    [selected_],
  );
  const winter = React.useMemo(
    () => buildTermBlocks(selected_, "winter", { preview: true }),
    [selected_],
  );
  const chips = React.useMemo(() => candidateChips(candidate), [candidate]);
  const tone = scoreTone(candidate.score);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className={cn(
        "w-full cursor-pointer rounded-md border bg-background p-3 text-left shadow-xs outline-none transition-colors hover:bg-muted/30 focus-visible:ring-[3px] focus-visible:ring-ring/50",
        selected && "ring-2 ring-ring",
      )}
      onClick={onPreview}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPreview();
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Candidate {index + 1}</span>
          {selected && (
            <Badge variant="outline" className="border-ring/50 text-[10px] font-normal">
              Previewing
            </Badge>
          )}
        </div>
        <Badge className={SCORE_TONE_CLASS[tone]}>{candidate.score.toFixed(1)}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CandidateThumbnail label="Fall" blocks={fall.blocks} />
        <CandidateThumbnail label="Winter" blocks={winter.blocks} />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {chips.map((chip) => {
          const Icon = CHIP_ICONS[chip.key];

          return (
            <div
              key={chip.key}
              className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs"
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium tabular-nums">{chip.value}</span>
              <span className="truncate text-muted-foreground">{chip.label}</span>
            </div>
          );
        })}
      </div>

      {selected && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="flex-1"
            onClick={(event) => {
              event.stopPropagation();
              onApply();
            }}
          >
            <Check />
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={(event) => {
              event.stopPropagation();
              onDiscard();
            }}
          >
            <X />
            Discard
          </Button>
        </div>
      )}

      <button
        type="button"
        className="mt-2 flex w-full items-center justify-between rounded-sm px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation();
          setDetailsOpen((open) => !open);
        }}
        aria-expanded={detailsOpen}
      >
        <span>Details</span>
        <ChevronDown
          className={cn("size-3.5 transition-transform", detailsOpen && "rotate-180")}
        />
      </button>
      {detailsOpen && (
        <ul className="mt-1 space-y-1 px-1 text-xs text-muted-foreground">
          {candidate.metrics.map((metric) => (
            <li key={metric.ruleId}>{metric.detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateThumbnail({
  label,
  blocks,
}: {
  label: string;
  blocks: ReturnType<typeof buildTermBlocks>["blocks"];
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium text-muted-foreground">{label}</p>
      <WeekGrid blocks={blocks} compact />
    </div>
  );
}
