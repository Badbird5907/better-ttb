import type { DegreeProgram, ProgramProgress } from "@better-ttb/shared";
import { evaluateProgram } from "@better-ttb/shared";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
  Trash2,
} from "lucide-react";
import * as React from "react";

import { useInProgressCourseCodes } from "@/lib/degree/in-progress";
import {
  pendingInProgressCodes,
  projectProgramProgress,
  unionCreditWeights,
  type ProgramProjection,
} from "@/lib/degree/projection";
import type { RequisiteGraph } from "@/lib/requisites/graph";
import { sanitizeHtml } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { useCompletedCoursesStore } from "@/stores/completed-courses";
import { NO_OVERRIDES, useDegreePlanStore } from "@/stores/degree";
import { creditWeightsFromCompleted } from "@/components/completed-courses/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatCredits, ProgramTypeBadge, ProgressBar } from "./program-meta";
import { ReqProvider } from "./req-view";
import { RequirementList } from "./requirement-list";

const CONFIRM_REMOVE_TIMEOUT_MS = 4000;

const RAW_HTML_CLASSES =
  "text-sm leading-6 text-muted-foreground [&_a]:text-primary [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc";

/** DOM id used by the summary strip's jump-to chips. */
export function programCardDomId(programId: string): string {
  return `degree-program-${programId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

/**
 * The two pure inputs every evaluation of `program` needs: the completed
 * courses as *credit weights* and the manually ticked clause keys.
 */
function useProgramInputs(program: DegreeProgram) {
  const completed = useCompletedCoursesStore((state) => state.courses);
  const overrides = useDegreePlanStore(
    (state) => state.manualOverrides[program.id] ?? NO_OVERRIDES,
  );

  const overrideSet = React.useMemo(() => new Set(overrides), [overrides]);

  // The store maps code -> grade %, but `evaluateProgram` reads a number as an
  // explicit credit weight — see `creditWeightsFromCompleted`.
  const creditWeights = React.useMemo(
    () => creditWeightsFromCompleted(completed),
    [completed],
  );

  return { creditWeights, overrideSet };
}

/**
 * Computes progress for one program. Split out so the memo keys are obvious:
 * the evaluation is pure over (program, completed courses, manual overrides).
 */
export function useProgramProgress(program: DegreeProgram) {
  const { creditWeights, overrideSet } = useProgramInputs(program);

  return React.useMemo(
    () => evaluateProgram(program, creditWeights, overrideSet),
    [program, creditWeights, overrideSet],
  );
}

export interface ProgramEvaluation {
  /** Completed courses only — what drives the per-clause checklist. */
  progress: ProgramProgress;
  /** Same, widened with the active timetable's pinned courses. */
  projection: ProgramProjection;
}

/**
 * Progress plus the projection that includes the active timetable's pinned
 * courses. The projection is a second real evaluation over the widened weight
 * map rather than an estimate, so a pinned course no clause can use adds
 * nothing — and it is skipped entirely when nothing is pinned.
 */
export function useProgramEvaluation(
  program: DegreeProgram,
): ProgramEvaluation {
  const { creditWeights, overrideSet } = useProgramInputs(program);
  const inProgress = useInProgressCourseCodes();

  return React.useMemo(() => {
    const progress = evaluateProgram(program, creditWeights, overrideSet);
    const pending = pendingInProgressCodes(creditWeights, inProgress);

    if (pending.length === 0) {
      return { progress, projection: projectProgramProgress(progress, null) };
    }

    const projected = evaluateProgram(
      program,
      unionCreditWeights(creditWeights, pending),
      overrideSet,
    );

    return {
      progress,
      projection: projectProgramProgress(progress, projected),
    };
  }, [program, creditWeights, overrideSet, inProgress]);
}

export function ProgramCard({
  program,
  defaultExpanded,
  graph,
  onOpenCourse,
}: {
  program: DegreeProgram;
  defaultExpanded: boolean;
  graph: RequisiteGraph | null;
  onOpenCourse: (code: string) => void;
}): React.ReactElement {
  const removeProgram = useDegreePlanStore((state) => state.removeProgram);
  const toggleOverride = useDegreePlanStore((state) => state.toggleOverride);
  const clearOverrides = useDegreePlanStore((state) => state.clearOverrides);

  const { progress, projection } = useProgramEvaluation(program);
  const completion = program.completion;

  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const [showEnrolment, setShowEnrolment] = React.useState(false);
  // A "none" parse recovered no structure at all, so the original text is the
  // only useful thing we can show — open it by default in that case.
  const [showRaw, setShowRaw] = React.useState(
    completion?.confidence === "none",
  );
  const [confirmingRemove, setConfirmingRemove] = React.useState(false);

  React.useEffect(() => {
    if (!confirmingRemove) {
      return;
    }

    const timeout = window.setTimeout(
      () => setConfirmingRemove(false),
      CONFIRM_REMOVE_TIMEOUT_MS,
    );

    return () => window.clearTimeout(timeout);
  }, [confirmingRemove]);

  const handleToggleOverride = React.useCallback(
    (clauseKey: string) => toggleOverride(program.id, clauseKey),
    [program.id, toggleOverride],
  );

  const overrideCount = useDegreePlanStore(
    (state) => (state.manualOverrides[program.id] ?? NO_OVERRIDES).length,
  );

  return (
    <article
      id={programCardDomId(program.id)}
      className="scroll-mt-4 rounded-lg border bg-card text-card-foreground shadow-sm"
    >
      <header className="space-y-2 p-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {expanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="min-w-0 text-left text-sm font-semibold hover:underline"
              >
                {program.name}
              </button>
              <ProgramTypeBadge type={program.type} />
              {program.degree !== null && (
                <span className="text-[11px] text-muted-foreground capitalize">
                  {program.degree}
                </span>
              )}
            </div>

            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              <a
                href={program.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono hover:text-foreground hover:underline"
              >
                {program.code ?? "calendar"}
                <ExternalLink className="size-3" />
              </a>
              {program.sections.length > 0 && (
                <span className="truncate">{program.sections.join(" · ")}</span>
              )}
            </div>
          </div>

          {confirmingRemove ? (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="destructive"
                size="xs"
                onClick={() => removeProgram(program.id)}
              >
                Remove
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setConfirmingRemove(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${program.name}`}
              className="shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmingRemove(true)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>

        <ProgramProgressSummary
          earnedCredits={progress.earnedCredits}
          totalCredits={progress.totalCredits}
          percent={progress.percent}
          inProgressCredits={projection.inProgressCredits}
          projectedPercent={projection.projectedPercent}
          metClauses={progress.metClauses}
          totalClauses={progress.totalClauses}
          // Nothing was recovered from the calendar text, so there is no
          // requirement count or progress to report — only the raw text below.
          parsed={completion?.confidence !== "none"}
        />
      </header>

      {expanded && (
        <div className="space-y-3 border-t p-3">
          {program.enrolmentRawHtml !== null && (
            <Disclosure
              label="Enrolment requirements"
              open={showEnrolment}
              onToggle={() => setShowEnrolment((current) => !current)}
            >
              <div
                className={RAW_HTML_CLASSES}
                dangerouslySetInnerHTML={{
                  __html: sanitizeHtml(program.enrolmentRawHtml),
                }}
              />
            </Disclosure>
          )}

          {completion === null ? (
            <p className="text-sm text-muted-foreground">
              The calendar lists no completion requirements for this program.
            </p>
          ) : (
            <>
              {completion.confidence !== "full" && (
                <p className="flex items-start gap-1.5 rounded-md border border-dashed border-border bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  <Info className="mt-px size-3.5 shrink-0" />
                  <span>
                    {completion.confidence === "none"
                      ? "We couldn't parse these requirements — the calendar text below is the source of truth."
                      : "Some of these requirements couldn't be parsed. Check them against the original text and tick anything off by hand."}
                  </span>
                </p>
              )}

              {completion.confidence !== "none" && (
                <ReqProvider graph={graph} onOpenCourse={onOpenCourse}>
                  <RequirementList
                    completion={completion}
                    progress={progress}
                    onToggleOverride={handleToggleOverride}
                  />
                </ReqProvider>
              )}

              <Separator />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-expanded={showRaw}
                  onClick={() => setShowRaw((current) => !current)}
                  className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {showRaw ? "Hide original text" : "Show original text"}
                </button>
                {overrideCount > 0 && (
                  <button
                    type="button"
                    onClick={() => clearOverrides(program.id)}
                    className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Clear {overrideCount} manual{" "}
                    {overrideCount === 1 ? "check" : "checks"}
                  </button>
                )}
              </div>

              {showRaw && (
                <div
                  className={cn(
                    RAW_HTML_CLASSES,
                    "rounded-md border bg-muted/30 p-3",
                  )}
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtml(completion.rawHtml),
                  }}
                />
              )}
            </>
          )}
        </div>
      )}
    </article>
  );
}

export function ProgramProgressSummary({
  earnedCredits,
  totalCredits,
  percent,
  inProgressCredits = 0,
  projectedPercent,
  metClauses,
  totalClauses,
  parsed = true,
}: {
  earnedCredits: number;
  totalCredits: number | null;
  percent: number | null;
  /** Extra credits the active timetable's pinned courses would contribute. */
  inProgressCredits?: number;
  projectedPercent?: number | null | undefined;
  metClauses: number;
  totalClauses: number;
  /** False when no requirement could be parsed: report nothing rather than 0. */
  parsed?: boolean;
}): React.ReactElement {
  if (!parsed) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
        <span className="tabular-nums">
          {totalCredits === null ? (
            <span className="text-muted-foreground">Credits not stated</span>
          ) : (
            <>
              <span className="font-semibold">
                {formatCredits(totalCredits)}
              </span>
              <span className="text-muted-foreground"> credits</span>
            </>
          )}
        </span>
        <span className="text-muted-foreground">
          we can&apos;t check this program automatically
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
        <span className="tabular-nums">
          <span className="font-semibold">{formatCredits(earnedCredits)}</span>
          <span className="text-muted-foreground">
            {totalCredits === null ? " credits counted" : " done"}
          </span>
          {inProgressCredits > 0 && (
            <span className="text-sky-700 dark:text-sky-300">
              {` · +${formatCredits(inProgressCredits)} in progress`}
            </span>
          )}
          {totalCredits !== null && (
            <span className="text-muted-foreground">
              {` / ${formatCredits(totalCredits)} credits`}
            </span>
          )}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {totalClauses === 0
            ? "progress unavailable"
            : `${metClauses}/${totalClauses} requirements met`}
        </span>
      </div>
      <ProgressBar percent={percent} projectedPercent={projectedPercent} />
    </div>
  );
}

function Disclosure({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-muted/20">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        {label}
      </button>
      {open && <div className="px-2.5 pt-0 pb-2.5">{children}</div>}
    </div>
  );
}
