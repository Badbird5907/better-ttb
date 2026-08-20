import type { ProgramReq } from "@better-ttb/shared";
import * as React from "react";

import type { RequisiteGraph } from "@/lib/requisites/graph";
import { cn } from "@/lib/utils";
import { PathCourseChip } from "./path-course-chip";
import { formatCredits } from "./program-meta";

/**
 * Renders a parsed `ProgramReq` as a flat, scannable checklist row rather than
 * a faithful tree. Degree requirements nest three or four levels deep in the
 * calendar ("(A, B, C/D) / (E, F)"), and drawing that literally produces an
 * unreadable staircase — so past {@link MAX_BLOCK_DEPTH} everything collapses
 * into a single chip row with inline "or" / "+" connectives.
 */

/** Below this depth, requirements stack vertically; past it they go inline. */
const MAX_BLOCK_DEPTH = 2;

/** Options shown before the "+N more" expander appears. */
const OPTION_CAP = 14;

interface ReqContextValue {
  graph: RequisiteGraph | null;
  onOpenCourse: (code: string) => void;
}

const ReqContext = React.createContext<ReqContextValue | null>(null);

export function ReqProvider({
  graph,
  onOpenCourse,
  children,
}: ReqContextValue & { children: React.ReactNode }): React.ReactElement {
  const value = React.useMemo<ReqContextValue>(
    () => ({ graph, onOpenCourse }),
    [graph, onOpenCourse],
  );

  return <ReqContext.Provider value={value}>{children}</ReqContext.Provider>;
}

function useReqContext(): ReqContextValue {
  const value = React.useContext(ReqContext);

  if (value === null) {
    throw new Error("Requirement view rendered outside <ReqProvider>");
  }

  return value;
}

// ---------------------------------------------------------------------------
// Block level
// ---------------------------------------------------------------------------

export function ReqBlock({
  req,
  depth = 0,
}: {
  req: ProgramReq;
  depth?: number;
}): React.ReactElement | null {
  switch (req.kind) {
    case "course":
      return (
        <OptionRow>
          <CourseChip code={req.code} />
        </OptionRow>
      );

    case "allOf": {
      if (depth >= MAX_BLOCK_DEPTH) {
        return (
          <OptionRow>
            <ReqInline req={req} />
          </OptionRow>
        );
      }

      return (
        <div className="space-y-1.5">
          {req.items.map((item, index) => (
            <ReqBlock key={index} req={item} depth={depth + 1} />
          ))}
        </div>
      );
    }

    case "oneOf":
      return (
        <LabelledOptions label="One of">
          {req.items.map((item, index) => (
            <ReqInline key={index} req={item} />
          ))}
        </LabelledOptions>
      );

    case "chooseCredits":
      return (
        <LabelledOptions
          label={`${formatCredits(req.credits)} credits from`}
          empty="no options listed"
        >
          {req.from.map((item, index) => (
            <ReqInline key={index} req={item} />
          ))}
        </LabelledOptions>
      );

    case "pool":
      return (
        <OptionRow>
          <PoolPill req={req} />
        </OptionRow>
      );

    case "text":
      return req.text.trim().length === 0 ? null : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {req.text}
        </p>
      );
  }
}

// ---------------------------------------------------------------------------
// Inline level
// ---------------------------------------------------------------------------

function ReqInline({ req }: { req: ProgramReq }): React.ReactElement | null {
  switch (req.kind) {
    case "course":
      return <CourseChip code={req.code} />;

    case "allOf":
      return <Connected items={req.items} connective="+" />;

    case "oneOf":
      return <Connected items={req.items} connective="or" />;

    case "chooseCredits":
      return (
        <span className="inline-flex flex-wrap items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {formatCredits(req.credits)} cr from
          </span>
          {req.from.map((item, index) => (
            <ReqInline key={index} req={item} />
          ))}
        </span>
      );

    case "pool":
      return <PoolPill req={req} />;

    case "text":
      return req.text.trim().length === 0 ? null : (
        <span className="text-xs text-muted-foreground italic">{req.text}</span>
      );
  }
}

/** A parenthesised group, e.g. `(CSC108H1 + CSC148H1)`. */
function Connected({
  items,
  connective,
}: {
  items: readonly ProgramReq[];
  connective: string;
}): React.ReactElement {
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-md border border-dashed border-border/70 px-1 py-0.5">
      {items.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {connective}
            </span>
          )}
          <ReqInline req={item} />
        </React.Fragment>
      ))}
    </span>
  );
}

function PoolPill({
  req,
}: {
  req: Extract<ProgramReq, { kind: "pool" }>;
}): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground italic">
      {req.description.length > 0 ? req.description : "unspecified courses"}
      {req.credits !== null && (
        <span className="font-medium not-italic">
          {formatCredits(req.credits)} cr
        </span>
      )}
    </span>
  );
}

function CourseChip({ code }: { code: string }): React.ReactElement {
  const { graph, onOpenCourse } = useReqContext();

  return <PathCourseChip code={code} graph={graph} onOpenCourse={onOpenCourse} />;
}

// ---------------------------------------------------------------------------
// Chip rows
// ---------------------------------------------------------------------------

function OptionRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string | undefined;
}): React.ReactElement {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {children}
    </div>
  );
}

/**
 * "One of" / "N credits from" followed by its options. Long option lists (some
 * programs list 40 courses) collapse behind a "+N more" toggle.
 */
function LabelledOptions({
  label,
  empty,
  children,
}: {
  label: string;
  empty?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);

  const items = React.Children.toArray(children);
  const overflow = Math.max(0, items.length - OPTION_CAP);
  const visible = expanded ? items : items.slice(0, OPTION_CAP);

  return (
    <OptionRow>
      <span className="shrink-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {items.length === 0 && empty !== undefined ? (
        <span className="text-xs text-muted-foreground italic">{empty}</span>
      ) : (
        visible
      )}
      {overflow > 0 && !expanded && (
        <button
          type="button"
          className="rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-ring hover:text-foreground"
          onClick={() => setExpanded(true)}
        >
          +{overflow} more
        </button>
      )}
    </OptionRow>
  );
}
