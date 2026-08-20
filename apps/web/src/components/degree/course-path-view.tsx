import { Link } from "@tanstack/react-router";
import type { Course } from "@better-ttb/shared";
import { ArrowRight, Check, CircleAlert, Network } from "lucide-react";
import * as React from "react";

import { useInProgressCourses } from "@/lib/degree/in-progress";
import type { ParsedRequisite, ReqNode } from "@/lib/requisites/ast";
import { collectCourseLeaves, type RequisiteGraph } from "@/lib/requisites/graph";
import {
  courseStatus,
  evaluateReq,
  type CompletedCourses,
  type ReqStatus,
} from "@/lib/requisites/satisfies";
import { preferredOffering, useRequisiteGraph } from "@/lib/requisites/use-graph";
import { sanitizeHtml } from "@/lib/sanitize";
import { cn } from "@/lib/utils";
import { useCompletedCoursesStore } from "@/stores/completed-courses";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PathCourseChip } from "./path-course-chip";
import {
  computeUnlockedCourses,
  creditWeightFromCode,
  flattenRequirementRows,
  formatCreditWeight,
  groupUnlocksByLevel,
  isUnverifiableNode,
  rowLabel,
  rowOptions,
  sectionLabel,
  summarizeRows,
  unverifiableText,
  type RequirementRow,
  type UnlockedCourse,
} from "./path-utils";

/** How many levels of "…and what does THAT need?" we will reveal inline. */
const MAX_EXPAND_DEPTH = 3;

/** Unlocked courses shown before the "+N more" expander kicks in. */
const UNLOCK_CAP = 15;

export interface CoursePathViewProps {
  /** Focus course, e.g. "CSC236H1". */
  code: string;
  /** Catalog courses (pass `catalog.courses`). */
  courses: Course[];
  /** Re-focus the panel on another course. */
  onOpenCourse?: ((code: string) => void) | undefined;
  className?: string | undefined;
}

interface PathContextValue {
  graph: RequisiteGraph;
  onOpenCourse: ((code: string) => void) | undefined;
}

const PathContext = React.createContext<PathContextValue | null>(null);

function usePathContext(): PathContextValue {
  const value = React.useContext(PathContext);

  if (value === null) {
    throw new Error("CoursePathView subcomponent rendered outside its provider");
  }

  return value;
}

/**
 * A legible, reading-order answer to "what do I need before this course, and
 * what does it unlock after?" — the calm alternative to the /tree DAG.
 */
export function CoursePathView({
  code,
  courses,
  onOpenCourse,
  className,
}: CoursePathViewProps): React.ReactElement {
  const graph = useRequisiteGraph(courses);
  const completed = useCompletedCoursesStore((state) => state.courses);
  const inProgress = useInProgressCourses();

  const graphNode = graph?.nodes.get(code) ?? null;
  const offering = React.useMemo(
    () => (graphNode ? preferredOffering(graphNode.offerings) : null),
    [graphNode],
  );

  const prereq = graphNode?.requisites.prereq ?? null;
  const coreq = graphNode?.requisites.coreq ?? null;

  const contextValue = React.useMemo<PathContextValue | null>(
    () => (graph ? { graph, onOpenCourse } : null),
    [graph, onOpenCourse],
  );

  const header = (
    <PathHeader
      code={code}
      name={offering?.name ?? null}
      sectionCode={offering?.sectionCode ?? null}
      prereq={prereq}
      completed={completed}
      inTimetable={inProgress.set.has(code)}
    />
  );

  if (contextValue === null) {
    return (
      <div className={cn("space-y-4", className)}>
        {header}
        <p className="text-sm text-muted-foreground">
          Course catalog is still loading.
        </p>
      </div>
    );
  }

  return (
    <PathContext.Provider value={contextValue}>
      <div className={cn("space-y-4", className)}>
        {header}

        {graphNode === null || !graphNode.inCatalog ? (
          <p className="text-sm text-muted-foreground">
            {code} isn&apos;t in the Arts &amp; Science catalog, so its path
            can&apos;t be mapped.
          </p>
        ) : (
          <>
            <Separator />
            <BeforeZone
              code={code}
              prereq={prereq}
              coreq={coreq}
              prereqHtml={offering?.cmCourseInfo?.prerequisitesText ?? null}
              coreqHtml={offering?.cmCourseInfo?.corequisitesText ?? null}
              completed={completed}
            />
            <Separator />
            <AfterZone
              code={code}
              completed={completed}
              inProgress={inProgress.codes}
            />
          </>
        )}
      </div>
    </PathContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// 1. Header
// ---------------------------------------------------------------------------

function PathHeader({
  code,
  name,
  sectionCode,
  prereq,
  completed,
  inTimetable,
}: {
  code: string;
  name: string | null;
  sectionCode: Course["sectionCode"] | null;
  prereq: ParsedRequisite | null;
  completed: CompletedCourses;
  inTimetable: boolean;
}): React.ReactElement {
  const setCourse = useCompletedCoursesStore((state) => state.setCourse);
  const removeCourse = useCompletedCoursesStore((state) => state.removeCourse);

  const isCompleted = courseStatus(code, undefined, completed) === "met";
  const weight = creditWeightFromCode(code);
  const term = sectionLabel(sectionCode);

  const eligibility = eligibilityPill(prereq, completed);

  const facts = [
    weight === null ? null : formatCreditWeight(weight),
    term,
  ].filter((fact): fact is string => fact !== null);

  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="font-mono text-base font-semibold">{code}</h2>
        {name !== null && (
          <span className="text-sm text-muted-foreground">{name}</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
            eligibility.tone,
          )}
        >
          {eligibility.icon}
          {eligibility.label}
        </span>

        {inTimetable && !isCompleted && (
          <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-500/20 dark:text-sky-200">
            In your timetable
          </span>
        )}

        {facts.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {facts.join(" · ")}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className={cn(
              "text-muted-foreground",
              isCompleted &&
                "text-emerald-700 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-300",
            )}
            aria-pressed={isCompleted}
            onClick={() => {
              if (isCompleted) {
                removeCourse(code);
              } else {
                setCourse(code, null);
              }
            }}
          >
            <Check />
            {isCompleted ? "Completed" : "Mark completed"}
          </Button>

          <Button
            asChild
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
          >
            <Link to="/tree" search={{ course: code }}>
              <Network />
              Open full graph
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

const EMERALD_PILL =
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300";
const AMBER_PILL =
  "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200";
const MUTED_PILL = "bg-muted text-muted-foreground";

function eligibilityPill(
  prereq: ParsedRequisite | null,
  completed: CompletedCourses,
): { label: string; tone: string; icon: React.ReactNode } {
  const root = prereq?.root ?? null;

  if (root === null) {
    return {
      label: "No prerequisites",
      tone: EMERALD_PILL,
      icon: <Check className="size-3" />,
    };
  }

  const status = evaluateReq(root, completed);

  if (status === "met") {
    return {
      label: "Prerequisites met",
      tone: EMERALD_PILL,
      icon: <Check className="size-3" />,
    };
  }

  if (status === "unknown") {
    return {
      label: "Prerequisites need review",
      tone: AMBER_PILL,
      icon: <CircleAlert className="size-3" />,
    };
  }

  return { label: "Prerequisites not met", tone: MUTED_PILL, icon: null };
}

// ---------------------------------------------------------------------------
// 2. Before
// ---------------------------------------------------------------------------

function BeforeZone({
  code,
  prereq,
  coreq,
  prereqHtml,
  coreqHtml,
  completed,
}: {
  code: string;
  prereq: ParsedRequisite | null;
  coreq: ParsedRequisite | null;
  prereqHtml: string | null;
  coreqHtml: string | null;
  completed: CompletedCourses;
}): React.ReactElement {
  const rows = React.useMemo(
    () => flattenRequirementRows(prereq?.root ?? null),
    [prereq],
  );
  const summary = React.useMemo(
    () => summarizeRows(rows, completed),
    [rows, completed],
  );
  const visited = React.useMemo(() => new Set([code]), [code]);

  const unparseable =
    prereq !== null && prereq.confidence === "none" && prereqHtml !== null;
  const allMet = rows.length > 0 && summary.satisfied === summary.total;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">
          Before you can take{" "}
          <span className="font-mono">{code}</span>
        </h3>
        {rows.length > 0 && !unparseable && (
          <p className="text-xs text-muted-foreground">
            {summary.total} requirement{summary.total === 1 ? "" : "s"} ·{" "}
            {summary.satisfied} satisfied
            {summary.unverified > 0 && ` · ${summary.unverified} unverified`}
          </p>
        )}
      </div>

      {rows.length === 0 && !unparseable ? (
        <ReadyCallout>
          No prerequisites listed — you can take this course.
        </ReadyCallout>
      ) : unparseable ? (
        <UnparsedRequisite html={prereqHtml} />
      ) : (
        <>
          {allMet && (
            <ReadyCallout>
              Every prerequisite is checked off — you can take this course.
            </ReadyCallout>
          )}
          <RequirementList rows={rows} numbered depth={0} visited={visited} />
        </>
      )}

      <CoreqRow coreq={coreq} coreqHtml={coreqHtml} />
      <RequisiteNotes notes={prereq?.notes ?? []} />
    </section>
  );
}

function ReadyCallout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <p
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
        EMERALD_PILL,
      )}
    >
      <Check className="size-4 shrink-0" />
      {children}
    </p>
  );
}

function UnparsedRequisite({
  html,
}: {
  html: string | null;
}): React.ReactElement {
  const sanitized = React.useMemo(() => sanitizeHtml(html), [html]);

  return (
    <div className="space-y-1.5 rounded-md border border-dashed p-3">
      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        Couldn&apos;t break this down — original text
      </p>
      <div
        className="text-sm leading-6 text-muted-foreground [&_a]:text-primary"
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    </div>
  );
}

function CoreqRow({
  coreq,
  coreqHtml,
}: {
  coreq: ParsedRequisite | null;
  coreqHtml: string | null;
}): React.ReactElement | null {
  const { graph, onOpenCourse } = usePathContext();
  const root = coreq?.root ?? null;

  const leaves = React.useMemo(() => collectCourseLeaves(root), [root]);
  const sanitized = React.useMemo(
    () => (leaves.length === 0 ? sanitizeHtml(coreqHtml) : ""),
    [leaves.length, coreqHtml],
  );

  if (leaves.length === 0 && sanitized.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md bg-muted/50 px-2.5 py-2">
      <span className="text-xs font-medium text-muted-foreground">
        Take together:
      </span>
      {leaves.length > 0 ? (
        leaves.map((leaf) => (
          <PathCourseChip
            key={leaf.code}
            code={leaf.code}
            minGrade={leaf.minGrade}
            graph={graph}
            onOpenCourse={onOpenCourse}
          />
        ))
      ) : (
        <div
          className="w-full text-xs text-muted-foreground [&_a]:text-primary"
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      )}
    </div>
  );
}

function RequisiteNotes({
  notes,
}: {
  notes: readonly string[];
}): React.ReactElement | null {
  if (notes.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      {notes.map((note, index) => (
        <p
          key={`${index}-${note.slice(0, 24)}`}
          className="text-xs text-muted-foreground"
        >
          {note}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Requirement checklist
// ---------------------------------------------------------------------------

function RequirementList({
  rows,
  numbered,
  depth,
  visited,
}: {
  rows: readonly RequirementRow[];
  numbered: boolean;
  depth: number;
  visited: ReadonlySet<string>;
}): React.ReactElement | null {
  if (rows.length === 0) {
    return null;
  }

  return (
    <ol className={cn("space-y-2", !numbered && "space-y-1.5")}>
      {rows.map((row, index) => (
        <RequirementRowView
          key={row.id}
          row={row}
          index={index}
          numbered={numbered}
          depth={depth}
          visited={visited}
        />
      ))}
    </ol>
  );
}

function RequirementRowView({
  row,
  index,
  numbered,
  depth,
  visited,
}: {
  row: RequirementRow;
  index: number;
  numbered: boolean;
  depth: number;
  visited: ReadonlySet<string>;
}): React.ReactElement {
  const completed = useCompletedCoursesStore((state) => state.courses);
  const unverifiable = isUnverifiableNode(row.node);
  const status: ReqStatus = unverifiable
    ? "unknown"
    : evaluateReq(row.node, completed);

  return (
    <li className="flex items-start gap-2">
      <StepMarker
        index={index}
        numbered={numbered}
        status={status}
        unverifiable={unverifiable}
      />
      <div className="min-w-0 flex-1 pt-px">
        <RowBody node={row.node} depth={depth} visited={visited} />
      </div>
    </li>
  );
}

function StepMarker({
  index,
  numbered,
  status,
  unverifiable,
}: {
  index: number;
  numbered: boolean;
  status: ReqStatus;
  unverifiable: boolean;
}): React.ReactElement {
  if (!numbered) {
    return (
      <span
        aria-hidden
        className={cn(
          "mt-2 size-1.5 shrink-0 rounded-full",
          status === "met" ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        status === "met"
          ? EMERALD_PILL
          : unverifiable || status === "unknown"
            ? AMBER_PILL
            : MUTED_PILL,
      )}
    >
      {status === "met" ? <Check className="size-3" /> : index + 1}
    </span>
  );
}

/**
 * One requirement rendered as a single wrapping line ("One of: A · B · C"),
 * plus—below the line—the inline prerequisite chains of any expanded chips.
 * Expansion state lives here so that expanded content never widens the chips.
 */
function RowBody({
  node,
  depth,
  visited,
}: {
  node: ReqNode;
  depth: number;
  visited: ReadonlySet<string>;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState<readonly string[]>([]);

  const toggle = React.useCallback((code: string) => {
    setExpanded((current) =>
      current.includes(code)
        ? current.filter((entry) => entry !== code)
        : [...current, code],
    );
  }, []);

  const options = rowOptions(node);
  const label = rowLabel(node);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {label !== null && (
          <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            {label}
          </span>
        )}
        {options === null ? (
          <OptionView
            node={node}
            depth={depth}
            visited={visited}
            expanded={expanded}
            onToggle={toggle}
          />
        ) : (
          options.map((option, index) => (
            <OptionView
              key={`${index}:${option.type}`}
              node={option}
              depth={depth}
              visited={visited}
              expanded={expanded}
              onToggle={toggle}
            />
          ))
        )}
      </div>

      {expanded.map((code) => (
        <ExpandedChain key={code} code={code} depth={depth} visited={visited} />
      ))}
    </div>
  );
}

function OptionView({
  node,
  depth,
  visited,
  expanded,
  onToggle,
}: {
  node: ReqNode;
  depth: number;
  visited: ReadonlySet<string>;
  expanded: readonly string[];
  onToggle: (code: string) => void;
}): React.ReactElement {
  const { graph, onOpenCourse } = usePathContext();
  const completed = useCompletedCoursesStore((state) => state.courses);

  if (node.type === "course") {
    const status = courseStatus(node.code, node.minGrade, completed);
    const expandable = canExpand(graph, node.code, status, visited, depth);

    return (
      <PathCourseChip
        code={node.code}
        minGrade={node.minGrade}
        graph={graph}
        onOpenCourse={onOpenCourse}
        expandable={expandable}
        expanded={expanded.includes(node.code)}
        onToggleExpanded={
          expandable ? () => onToggle(node.code) : undefined
        }
      />
    );
  }

  if (isUnverifiableNode(node)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground italic">
        {unverifiableText(node)}
        <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium tracking-wide text-muted-foreground not-italic">
          unverified
        </span>
      </span>
    );
  }

  // Nested group inside a row, e.g. "one of: (A and B), C".
  const nestedLabel = rowLabel(node) ?? "";
  const children = rowOptions(node) ?? [];

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 rounded-md border border-dashed px-1.5 py-1">
      <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {nestedLabel}
      </span>
      {children.map((child, index) => (
        <OptionView
          key={`${index}:${child.type}`}
          node={child}
          depth={depth}
          visited={visited}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </span>
  );
}

/** The inline "…and what does THAT need?" block under an expanded chip. */
function ExpandedChain({
  code,
  depth,
  visited,
}: {
  code: string;
  depth: number;
  visited: ReadonlySet<string>;
}): React.ReactElement | null {
  const { graph } = usePathContext();

  const prereq = graph.nodes.get(code)?.requisites.prereq ?? null;
  const rows = React.useMemo(
    () => flattenRequirementRows(prereq?.root ?? null),
    [prereq],
  );
  const nextVisited = React.useMemo(
    () => new Set([...visited, code]),
    [visited, code],
  );

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="ml-1 space-y-1.5 border-l border-border/70 pl-3">
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{code}</span> first needs:
      </p>
      <RequirementList
        rows={rows}
        numbered={false}
        depth={depth + 1}
        visited={nextVisited}
      />
    </div>
  );
}

function canExpand(
  graph: RequisiteGraph,
  code: string,
  status: ReqStatus,
  visited: ReadonlySet<string>,
  depth: number,
): boolean {
  // A satisfied course needs no chain: its own history is already behind you.
  if (status === "met" || visited.has(code) || depth + 1 > MAX_EXPAND_DEPTH) {
    return false;
  }

  const node = graph.nodes.get(code);
  const prereq = node?.requisites.prereq ?? null;

  return (
    node?.inCatalog === true &&
    prereq !== null &&
    prereq.confidence !== "none" &&
    prereq.root !== null
  );
}

// ---------------------------------------------------------------------------
// 3. After
// ---------------------------------------------------------------------------

function AfterZone({
  code,
  completed,
  inProgress,
}: {
  code: string;
  completed: CompletedCourses;
  inProgress: readonly string[];
}): React.ReactElement {
  const { graph, onOpenCourse } = usePathContext();
  const [showAll, setShowAll] = React.useState(false);

  const unlocked = React.useMemo(
    () => computeUnlockedCourses(graph, code, completed, inProgress),
    [graph, code, completed, inProgress],
  );

  const visible = React.useMemo(
    () => (showAll ? unlocked : unlocked.slice(0, UNLOCK_CAP)),
    [showAll, unlocked],
  );
  const hidden = unlocked.length - visible.length;
  const groups = React.useMemo(() => groupUnlocksByLevel(visible), [visible]);
  const readyAfterCount = unlocked.filter(
    (course) => course.status === "readyAfter",
  ).length;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">
          After: what <span className="font-mono">{code}</span> unlocks
        </h3>
        {unlocked.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {unlocked.length} course{unlocked.length === 1 ? "" : "s"}
            {readyAfterCount > 0 && ` · ${readyAfterCount} ready after this`}
          </p>
        )}
      </div>

      {unlocked.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No catalog course lists {code} as a prerequisite.
        </p>
      ) : (
        <div className="space-y-2.5">
          {groups.map((group) => (
            <div key={group.label} className="space-y-1.5">
              <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {group.courses.map((course) => (
                  <UnlockChip
                    key={course.code}
                    course={course}
                    graph={graph}
                    onOpenCourse={onOpenCourse}
                  />
                ))}
              </div>
            </div>
          ))}

          {hidden > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => setShowAll(true)}
            >
              <ArrowRight />+{hidden} more
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function UnlockChip({
  course,
  graph,
  onOpenCourse,
}: {
  course: UnlockedCourse;
  graph: RequisiteGraph;
  onOpenCourse: ((code: string) => void) | undefined;
}): React.ReactElement {
  const annotation =
    course.status === "readyAfter"
      ? "ready after this"
      : course.status === "readyAfterTerm"
        ? "ready after this term"
        : course.status === "ready"
          ? "ready now"
          : undefined;

  return (
    <PathCourseChip
      code={course.code}
      graph={graph}
      onOpenCourse={onOpenCourse}
      annotation={annotation}
      className={cn(
        course.status === "readyAfter" &&
          "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
        course.status === "readyAfterTerm" &&
          "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300",
      )}
    />
  );
}
