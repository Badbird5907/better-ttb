import type {
  ClauseProgress,
  ClauseStatus,
  ProgramClause,
  ProgramCompletion,
  ProgramProgress,
} from "@better-ttb/shared";
import { programClauseKey } from "@better-ttb/shared";
import { Check, Circle, CircleCheck, CircleDashed, CircleDot } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { formatCredits } from "./program-meta";
import { ReqBlock } from "./req-view";

/**
 * The requirements checklist for one program: sections -> clauses, each clause
 * with an automatic status, the courses it matched, and a manual override.
 *
 * The parse is best-effort (see `parseCompletionRequirements` in the shared
 * package), so every non-advisory clause is hand-checkable: the evaluator's
 * "unknown" is an invitation for the student to decide, not a dead end.
 */

const STATUS_ICONS: Readonly<
  Record<ClauseStatus, React.ComponentType<{ className?: string }>>
> = {
  met: CircleCheck,
  partial: CircleDot,
  unmet: Circle,
  unknown: CircleDashed,
};

const STATUS_CLASSES: Readonly<Record<ClauseStatus, string>> = {
  met: "text-emerald-600 dark:text-emerald-400",
  partial: "text-amber-600 dark:text-amber-400",
  unmet: "text-muted-foreground/50",
  unknown: "text-muted-foreground/70",
};

const STATUS_LABELS: Readonly<Record<ClauseStatus, string>> = {
  met: "Met",
  partial: "In progress",
  unmet: "Not started",
  unknown: "Can't verify",
};

export function RequirementList({
  completion,
  progress,
  onToggleOverride,
}: {
  completion: ProgramCompletion;
  progress: ProgramProgress;
  onToggleOverride: (clauseKey: string) => void;
}): React.ReactElement {
  return (
    <div className="space-y-4">
      {completion.sections.map((section, sectionIndex) => (
        <section key={sectionIndex} className="space-y-2">
          {(section.label !== null || section.credits !== null) && (
            <div className="flex items-baseline gap-2">
              {section.label !== null && (
                <h4 className="text-xs font-semibold tracking-wide text-foreground uppercase">
                  {section.label}
                </h4>
              )}
              {section.credits !== null && (
                <span className="text-xs text-muted-foreground">
                  {formatCredits(section.credits)} credits
                </span>
              )}
            </div>
          )}

          <ul className="space-y-2">
            {section.clauses.map((clause, clauseIndex) => {
              const key = programClauseKey(sectionIndex, clauseIndex);

              return (
                <ClauseRow
                  key={key}
                  clause={clause}
                  clauseKey={key}
                  progress={progress.clauses[key]}
                  onToggleOverride={onToggleOverride}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Long calendar notes (some run to whole paragraphs of departmental prose)
 * collapse to a few lines with an inline expander. The threshold is a
 * character-count heuristic rather than a measured overflow so the server and
 * first client paint agree on whether the button renders.
 */
const ADVISORY_CLAMP_THRESHOLD = 320;

function AdvisoryNoteText({ text }: { text: string }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const clampable = text.length > ADVISORY_CLAMP_THRESHOLD;

  return (
    <div className="min-w-0 flex-1">
      <p
        className={cn(
          "text-xs leading-relaxed text-muted-foreground",
          clampable && !expanded && "line-clamp-3",
        )}
      >
        {text}
      </p>
      {clampable && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function ClauseRow({
  clause,
  clauseKey,
  progress,
  onToggleOverride,
}: {
  clause: ProgramClause;
  clauseKey: string;
  progress: ClauseProgress | undefined;
  onToggleOverride: (clauseKey: string) => void;
}): React.ReactElement {
  if (clause.advisory) {
    return (
      <li className="flex gap-2 rounded-md border border-dashed border-border/70 bg-muted/30 px-2.5 py-1.5">
        <span className="shrink-0 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Note
        </span>
        <AdvisoryNoteText text={clause.text} />
      </li>
    );
  }

  const status = progress?.status ?? "unknown";
  const manual = progress?.manual ?? false;
  const StatusIcon = STATUS_ICONS[status];
  const requiredCredits = progress?.requiredCredits ?? clause.credits;
  const earnedCredits = progress?.earnedCredits ?? 0;
  const showHint = status === "unknown" && !manual;

  return (
    <li
      className={cn(
        "rounded-md border px-2.5 py-2 transition-colors",
        status === "met"
          ? "border-emerald-300/60 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-500/5"
          : "border-border bg-card",
      )}
    >
      <div className="flex gap-2">
        <StatusIcon
          className={cn("mt-0.5 size-4 shrink-0", STATUS_CLASSES[status])}
          aria-hidden
        />

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {clause.index !== null && (
              <span className="text-xs font-semibold text-muted-foreground">
                {clause.index}.
              </span>
            )}
            <span className="sr-only">{STATUS_LABELS[status]}</span>
            {requiredCredits !== null && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {formatCredits(earnedCredits)} / {formatCredits(requiredCredits)} cr
              </span>
            )}
            {manual && (
              <span className="rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300">
                manual
              </span>
            )}
          </div>

          {clause.req === null ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {clause.text}
            </p>
          ) : (
            <ReqBlock req={clause.req} />
          )}

          {showHint && (
            <p className="text-[11px] text-muted-foreground">
              Can&apos;t verify this one automatically — check it off yourself
              once you&apos;ve done it.
            </p>
          )}

          <OverrideToggle
            checked={manual}
            onToggle={() => onToggleOverride(clauseKey)}
          />
        </div>
      </div>
    </li>
  );
}

function OverrideToggle({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        checked
          ? "text-emerald-700 dark:text-emerald-400"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "inline-flex size-3.5 items-center justify-center rounded-[4px] border transition-colors",
          checked
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-border",
        )}
      >
        <Check
          className={cn("size-2.5", checked ? "opacity-100" : "opacity-0")}
          strokeWidth={3}
        />
      </span>
      {checked ? "Marked done" : "Mark done"}
    </button>
  );
}
