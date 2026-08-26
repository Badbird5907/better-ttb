import { Check, ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";

import { useInProgressCourseSet } from "@/lib/degree/in-progress";
import type { RequisiteGraph } from "@/lib/requisites/graph";
import { courseStatus, type ReqStatus } from "@/lib/requisites/satisfies";
import { preferredOffering } from "@/lib/requisites/use-graph";
import { cn } from "@/lib/utils";
import {
  isValidCourseCode,
  useCompletedCoursesStore,
} from "@/stores/completed-courses";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Emerald "satisfied" palette, kept consistent with SATISFIED_COURSE_CLASSES in
 * components/course/requisite-view.tsx.
 */
export const SATISFIED_CHIP_CLASSES =
  "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300";

/**
 * Sky "in progress" palette: pinned in the active timetable but not finished.
 * Deliberately not emerald — emerald means "done" everywhere in the app.
 */
export const IN_PROGRESS_CHIP_CLASSES =
  "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/20 dark:text-sky-200";

const NEUTRAL_CHIP_CLASSES =
  "border-transparent bg-secondary text-secondary-foreground";

const UNKNOWN_CHIP_CLASSES =
  "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200";

const OUT_OF_CATALOG_CHIP_CLASSES =
  "border-dashed border-border bg-transparent text-muted-foreground";

export interface PathCourseChipProps {
  code: string;
  minGrade?: number | undefined;
  graph: RequisiteGraph | null;
  /** Re-focus the panel on this course. */
  onOpenCourse?: ((code: string) => void) | undefined;
  /** Show the expand chevron (caller owns the expanded subtree). */
  expandable?: boolean | undefined;
  expanded?: boolean | undefined;
  onToggleExpanded?: (() => void) | undefined;
  /** Short trailing note, e.g. "ready after this". */
  annotation?: string | undefined;
  /** Override the computed status (used by the "After" zone). */
  status?: ReqStatus | undefined;
  className?: string | undefined;
}

/**
 * A course pill with three affordances, in reading order:
 *   [chevron?] [completion toggle] CODE (≥grade) (annotation?)
 *
 * The completion toggle is always rendered (a real target on touch) but stays
 * visually quiet until hover/focus when the course is not completed.
 */
export function PathCourseChip({
  code,
  minGrade,
  graph,
  onOpenCourse,
  expandable = false,
  expanded = false,
  onToggleExpanded,
  annotation,
  status,
  className,
}: PathCourseChipProps): React.ReactElement {
  const completed = useCompletedCoursesStore((state) => state.courses);
  const setCourse = useCompletedCoursesStore((state) => state.setCourse);
  const removeCourse = useCompletedCoursesStore((state) => state.removeCourse);
  // Read rather than threaded as a prop: the chip is rendered from four
  // different trees, and "is this in my timetable?" is the same answer in all
  // of them.
  const inProgressCodes = useInProgressCourseSet();

  const normalizedCode = code.trim().toUpperCase();
  const graphNode = graph?.nodes.get(normalizedCode) ?? null;
  const inCatalog = graphNode?.inCatalog ?? false;
  const resolved = status ?? courseStatus(normalizedCode, minGrade, completed);
  const isCompleted = Object.prototype.hasOwnProperty.call(
    completed,
    normalizedCode,
  );
  const grade = completed[normalizedCode] ?? null;
  const canToggle = isValidCourseCode(normalizedCode);
  // Completed wins: a course you already passed is done, not in progress.
  const isInProgress = !isCompleted && inProgressCodes.has(normalizedCode);

  const courseName = React.useMemo(() => {
    if (!graphNode || graphNode.offerings.length === 0) {
      return null;
    }

    return preferredOffering(graphNode.offerings)?.name ?? null;
  }, [graphNode]);

  const tone =
    resolved === "met"
      ? SATISFIED_CHIP_CLASSES
      : // "unknown" means completed-but-grade-unverified, so it outranks the
        // in-progress tint too.
        resolved === "unknown"
        ? UNKNOWN_CHIP_CLASSES
        : isInProgress
          ? IN_PROGRESS_CHIP_CLASSES
          : inCatalog
            ? NEUTRAL_CHIP_CLASSES
            : OUT_OF_CATALOG_CHIP_CLASSES;

  const label = (
    <>
      <span className="font-mono">{code}</span>
      {minGrade !== undefined && (
        <span className="font-normal opacity-80">{` ≥${minGrade}%`}</span>
      )}
    </>
  );

  const clickable = inCatalog && onOpenCourse !== undefined;

  const tooltipBody = (
    <>
      <span className="block">{courseName ?? code}</span>
      {!inCatalog && (
        <span className="block opacity-70">
          Not in the Arts &amp; Science catalog
        </span>
      )}
      {isCompleted && (
        <span className="block opacity-70">
          {grade === null ? "Marked completed" : `Completed · ${grade}%`}
        </span>
      )}
      {isInProgress && (
        <span className="block opacity-70">In your current timetable</span>
      )}
    </>
  );

  return (
    <span
      className={cn(
        "group/chip inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-2 pl-1 text-xs transition-colors",
        tone,
        className,
      )}
    >
      {expandable && (
        <button
          type="button"
          className="-ml-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `Hide prerequisites for ${code}`
              : `Show prerequisites for ${code}`
          }
          onClick={onToggleExpanded}
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
        </button>
      )}

      <button
        type="button"
        aria-pressed={isCompleted}
        aria-label={
          isCompleted
            ? `Mark ${code} as not completed`
            : `Mark ${code} as completed`
        }
        disabled={!canToggle}
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          isCompleted
            ? "border-current bg-current/15"
            : "border-current/40 opacity-50 group-hover/chip:opacity-100 hover:border-current hover:bg-current/10 focus-visible:opacity-100",
          !canToggle && "pointer-events-none opacity-30",
        )}
        onClick={() => {
          if (isCompleted) {
            removeCourse(code);
          } else {
            setCourse(code, null);
          }
        }}
      >
        <Check
          className={cn("size-2.5", isCompleted ? "opacity-100" : "opacity-0")}
          strokeWidth={3}
        />
      </button>

      <Tooltip>
        <TooltipTrigger asChild>
          {clickable ? (
            <button
              type="button"
              className="max-w-full cursor-pointer truncate rounded-full hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => onOpenCourse?.(code)}
            >
              {label}
            </button>
          ) : (
            <span className="max-w-full cursor-default truncate">{label}</span>
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{tooltipBody}</TooltipContent>
      </Tooltip>

      {/* The tint alone would be colour-only information. */}
      {isInProgress && (
        <span className="sr-only">in your current timetable</span>
      )}

      {annotation !== undefined && (
        <span className="shrink-0 rounded-full bg-current/10 px-1.5 text-[10px] font-medium tracking-wide opacity-90">
          {annotation}
        </span>
      )}
    </span>
  );
}
