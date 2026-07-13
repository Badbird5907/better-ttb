import * as React from "react";

import {
  isCourseNode,
  isCreditsNode,
  isGroupNode,
  isTextNode,
  type ParsedRequisite,
  type ReqNode,
} from "@/lib/requisites/ast";
import type { RequisiteGraph } from "@/lib/requisites/graph";
import { preferredOffering } from "@/lib/requisites/use-graph";
import { extractCourseCodes, parseRequisite } from "@/lib/requisites/parse";
import { courseStatus, evaluateReq } from "@/lib/requisites/satisfies";
import { sanitizeHtml } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { useCompletedCoursesStore } from "@/stores/completed-courses";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface RequisiteViewProps {
  title: string;
  html: string | null;
  graph: RequisiteGraph | null;
  onOpenCourse?: ((code: string) => void) | undefined;
  flat?: boolean;
}

export function RequisiteView({
  title,
  html,
  graph,
  onOpenCourse,
  flat = false,
}: RequisiteViewProps) {
  const [showOriginal, setShowOriginal] = React.useState(false);
  const parsed = React.useMemo(() => parseRequisite(html), [html]);
  const sanitized = React.useMemo(() => sanitizeHtml(html), [html]);
  const hasHtml = sanitized.length > 0;

  const flatCodes = React.useMemo(
    () => (flat ? extractCourseCodes(html) : []),
    [flat, html],
  );

  // Empty requirement: nothing structural, nothing to note.
  const isEmpty =
    !hasHtml ||
    (parsed.root === null &&
      parsed.notes.length === 0 &&
      (!flat || flatCodes.length === 0));

  if (isEmpty) {
    return (
      <section className="rounded-md border p-3">
        <h3 className="mb-2 text-sm font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">None listed</p>
      </section>
    );
  }

  // Whether we can offer a structured view at all.
  const canRenderStructured = flat
    ? flatCodes.length > 0
    : parsed.confidence !== "none" || parsed.root !== null;

  const showStructured = canRenderStructured && !showOriginal;

  return (
    <section className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hasHtml && canRenderStructured && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => setShowOriginal((current) => !current)}
          >
            {showOriginal ? "Show parsed" : "Show original"}
          </Button>
        )}
      </div>

      {showStructured ? (
        flat ? (
          <FlatRequisiteBody
            codes={flatCodes}
            notes={parsed.notes}
            graph={graph}
            onOpenCourse={onOpenCourse}
          />
        ) : (
          <StructuredRequisiteBody
            parsed={parsed}
            sanitized={sanitized}
            graph={graph}
            onOpenCourse={onOpenCourse}
          />
        )
      ) : (
        <OriginalHtml sanitized={sanitized} />
      )}
    </section>
  );
}

function StructuredRequisiteBody({
  parsed,
  sanitized,
  graph,
  onOpenCourse,
}: {
  parsed: ParsedRequisite;
  sanitized: string;
  graph: RequisiteGraph | null;
  onOpenCourse: ((code: string) => void) | undefined;
}) {
  // No parsed structure (confidence "none" with content, or no graph): fall back
  // to the sanitized original, exactly like RequirementBlock does today.
  if (parsed.confidence === "none" || parsed.root === null) {
    if (parsed.root !== null || parsed.notes.length === 0) {
      return <OriginalHtml sanitized={sanitized} />;
    }
    // root === null but there are notes: show only the notes.
    return <RequisiteNotes notes={parsed.notes} />;
  }

  return (
    <div className="space-y-2">
      <ReqNodeView node={parsed.root} graph={graph} onOpenCourse={onOpenCourse} />
      <RequisiteNotes notes={parsed.notes} />
    </div>
  );
}

function FlatRequisiteBody({
  codes,
  notes,
  graph,
  onOpenCourse,
}: {
  codes: string[];
  notes: string[];
  graph: RequisiteGraph | null;
  onOpenCourse: ((code: string) => void) | undefined;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {codes.map((code) => (
          <CourseChip
            key={code}
            code={code}
            graph={graph}
            onOpenCourse={onOpenCourse}
          />
        ))}
      </div>
      <RequisiteNotes notes={notes} />
    </div>
  );
}

function OriginalHtml({ sanitized }: { sanitized: string }) {
  return (
    <div
      className="text-sm leading-6 text-muted-foreground [&_a]:text-primary"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

function RequisiteNotes({ notes }: { notes: string[] }) {
  if (notes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      {notes.map((note, index) => (
        <p key={`${index}-${note.slice(0, 24)}`} className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AST renderer (shared with mini-prereq-tree.tsx)
// ---------------------------------------------------------------------------

const GROUP_LABELS: Record<"and" | "or" | "nOf", (n: number) => string> = {
  and: () => "ALL OF",
  or: () => "ONE OF",
  nOf: (n) => `${n} OF`,
};

const SATISFIED_COURSE_CLASSES =
  "border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-100/80 dark:border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-300";

const SATISFIED_GROUP_CLASSES =
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300";

export function ReqNodeView({
  node,
  graph,
  onOpenCourse,
}: {
  node: ReqNode;
  graph: RequisiteGraph | null;
  onOpenCourse: ((code: string) => void) | undefined;
}) {
  const courses = useCompletedCoursesStore((state) => state.courses);

  if (isCourseNode(node)) {
    return (
      <CourseChip
        code={node.code}
        minGrade={node.minGrade}
        graph={graph}
        onOpenCourse={onOpenCourse}
      />
    );
  }

  if (isCreditsNode(node)) {
    return <span className="text-sm font-medium text-foreground">{node.raw}</span>;
  }

  if (isTextNode(node)) {
    return <span className="text-sm italic text-muted-foreground">{node.text}</span>;
  }

  // Group node (and / or / nOf).
  const n = node.type === "nOf" ? node.n : 0;
  const label = GROUP_LABELS[node.type](n);
  const status = evaluateReq(node, courses);
  const allLeaves = node.children.every(
    (child) => isCourseNode(child) || isCreditsNode(child) || isTextNode(child),
  );

  return (
    <div className="space-y-1">
      <GroupBadge label={label} satisfied={status === "met"} />
      {allLeaves ? (
        <div className="flex flex-wrap items-center gap-1.5 pl-1">
          {node.children.map((child, index) => (
            <ReqNodeView
              key={index}
              node={child}
              graph={graph}
              onOpenCourse={onOpenCourse}
            />
          ))}
        </div>
      ) : (
        <div className="ml-1 space-y-1.5 border-l border-border/70 pl-3">
          {node.children.map((child, index) => (
            <div key={index}>
              <ReqNodeView node={child} graph={graph} onOpenCourse={onOpenCourse} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupBadge({
  label,
  satisfied = false,
}: {
  label: string;
  satisfied?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        satisfied
          ? SATISFIED_GROUP_CLASSES
          : "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

export function CourseChip({
  code,
  minGrade,
  graph,
  onOpenCourse,
}: {
  code: string;
  minGrade?: number | undefined;
  graph: RequisiteGraph | null;
  onOpenCourse: ((code: string) => void) | undefined;
}) {
  const courses = useCompletedCoursesStore((state) => state.courses);
  const node = graph?.nodes.get(code);
  const inCatalog = node?.inCatalog ?? false;
  const status = courseStatus(code, minGrade, courses);
  const courseName = React.useMemo(() => {
    if (!node || node.offerings.length === 0) {
      return null;
    }
    return preferredOffering(node.offerings)?.name ?? null;
  }, [node]);

  const label = (
    <>
      {code}
      {minGrade !== undefined && (
        <span className="font-normal opacity-80">{` ≥${minGrade}%`}</span>
      )}
    </>
  );

  if (inCatalog && onOpenCourse) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              badgeVariants({ variant: "secondary" }),
              "cursor-pointer font-mono text-xs hover:bg-secondary/70 focus-visible:ring-[3px] focus-visible:ring-ring/50",
              status === "met" && SATISFIED_COURSE_CLASSES,
            )}
            onClick={() => onOpenCourse(code)}
          >
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {courseName ?? code}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Out-of-catalog: dimmed, non-interactive.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            badgeVariants({ variant: "outline" }),
            "cursor-default border-dashed font-mono text-xs",
            status === "met"
              ? SATISFIED_COURSE_CLASSES
              : "text-muted-foreground opacity-70",
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        Not in the Arts &amp; Science catalog
      </TooltipContent>
    </Tooltip>
  );
}
