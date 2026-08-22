import type { ProgramType } from "@better-ttb/shared";
import * as React from "react";

import { cn } from "@/lib/utils";

/** Shared presentational atoms for the degree planner. */

export const PROGRAM_TYPE_LABELS: Readonly<Record<ProgramType, string>> = {
  specialist: "Specialist",
  major: "Major",
  minor: "Minor",
  focus: "Focus",
  certificate: "Certificate",
};

/**
 * One hue per program type so a stack of cards is scannable. Emerald is
 * reserved for "satisfied" everywhere in the app, so it is not used here.
 */
const PROGRAM_TYPE_CLASSES: Readonly<Record<ProgramType, string>> = {
  specialist:
    "border-violet-300 bg-violet-100 text-violet-800 dark:border-violet-500/40 dark:bg-violet-500/20 dark:text-violet-200",
  major:
    "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/20 dark:text-sky-200",
  minor:
    "border-teal-300 bg-teal-100 text-teal-800 dark:border-teal-500/40 dark:bg-teal-500/20 dark:text-teal-200",
  focus:
    "border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200",
  certificate:
    "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-200",
};

export function ProgramTypeBadge({
  type,
  className,
}: {
  type: ProgramType;
  className?: string | undefined;
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        PROGRAM_TYPE_CLASSES[type],
        className,
      )}
    >
      {PROGRAM_TYPE_LABELS[type]}
    </span>
  );
}

/** `1` -> "1.0", `1.25` -> "1.25" — credits read as decimals in the calendar. */
export function formatCredits(credits: number): string {
  return Number.isInteger(credits * 2)
    ? credits.toFixed(1)
    : String(Math.round(credits * 100) / 100);
}

function clampPercent(percent: number | null): number {
  return percent === null ? 0 : Math.min(100, Math.max(0, percent));
}

/**
 * Minimal determinate bar. There is no shadcn progress primitive in this app,
 * and a few divs keep the token palette and dark mode for free.
 *
 * Two segments: emerald for credits already earned, yellow for the delta the
 * in-progress (pinned) courses would add — where the bar will stand once the
 * current timetable is finished. `aria-valuenow` stays on the earned figure —
 * the projection is a hint, not progress.
 */
export function ProgressBar({
  percent,
  projectedPercent,
  className,
}: {
  percent: number | null;
  /** Completed + in-progress. Defaults to `percent` (nothing in progress). */
  projectedPercent?: number | null | undefined;
  className?: string | undefined;
}): React.ReactElement {
  const done = clampPercent(percent);
  const projected =
    projectedPercent === undefined ? done : clampPercent(projectedPercent);
  const pending = Math.max(0, projected - done);

  return (
    <div
      className={cn(
        "flex h-1.5 w-full overflow-hidden rounded-full bg-muted",
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === null ? {} : { "aria-valuenow": done })}
      {...(pending > 0
        ? { "aria-valuetext": `${done}% done, ${projected}% including courses in progress` }
        : {})}
    >
      <div
        className={cn(
          "h-full transition-[width] duration-300",
          percent === null ? "bg-muted-foreground/30" : "bg-emerald-500",
        )}
        style={{ width: `${percent === null ? 0 : done}%` }}
      />
      {pending > 0 && (
        <div
          className="h-full bg-yellow-400/80 transition-[width] duration-300 dark:bg-yellow-500/70"
          style={{ width: `${pending}%` }}
        />
      )}
    </div>
  );
}
