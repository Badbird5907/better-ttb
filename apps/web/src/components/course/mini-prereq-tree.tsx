import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Network } from "lucide-react";
import * as React from "react";

import { type ReqNode } from "@/lib/requisites/ast";
import type { RequisiteGraph } from "@/lib/requisites/graph";
import { Button } from "@/components/ui/button";
import { CourseChip, ReqNodeView } from "./requisite-view";

const MAX_DEPTH = 5;
const DIRECT_DEPENDENT_CAP = 24;

interface MiniPrereqTreeProps {
  code: string;
  graph: RequisiteGraph;
  onOpenCourse?: ((code: string) => void) | undefined;
}

export function MiniPrereqTree({
  code,
  graph,
  onOpenCourse,
}: MiniPrereqTreeProps) {
  const prereq = graph.nodes.get(code)?.requisites.prereq ?? null;
  const hasStructuredPrereq =
    prereq !== null && prereq.confidence !== "none" && prereq.root !== null;

  const dependents = React.useMemo(
    () => directPrereqDependents(graph, code),
    [graph, code],
  );

  if (!hasStructuredPrereq && dependents.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Prerequisite tree</h3>

      {hasStructuredPrereq && prereq?.root && (
        <div className="rounded-md border p-3">
          <PrereqBranch
            node={prereq.root}
            graph={graph}
            onOpenCourse={onOpenCourse}
            visited={new Set([code])}
            depth={0}
          />
        </div>
      )}

      <RequiredBy
        dependents={dependents}
        graph={graph}
        onOpenCourse={onOpenCourse}
      />

      <Button asChild variant="outline" size="sm">
        <Link to="/tree" search={{ course: code }}>
          <Network />
          View full tree
        </Link>
      </Button>
    </section>
  );
}

/**
 * Renders an AST branch, but course leaves that themselves carry structured
 * prerequisites gain an expand toggle that reveals their prereq tree inline.
 */
function PrereqBranch({
  node,
  graph,
  onOpenCourse,
  visited,
  depth,
}: {
  node: ReqNode;
  graph: RequisiteGraph;
  onOpenCourse: ((code: string) => void) | undefined;
  visited: Set<string>;
  depth: number;
}) {
  // Course leaf: maybe expandable.
  if (node.type === "course") {
    return (
      <ExpandableCourse
        code={node.code}
        minGrade={node.minGrade}
        graph={graph}
        onOpenCourse={onOpenCourse}
        visited={visited}
        depth={depth}
      />
    );
  }

  // Non-course leaves render as plain nodes (credits / text).
  if (node.type === "credits" || node.type === "text") {
    return <ReqNodeView node={node} graph={graph} onOpenCourse={onOpenCourse} />;
  }

  // Group node: label + children. Keep expandability by recursing per child.
  const n = node.type === "nOf" ? node.n : 0;
  const label =
    node.type === "and" ? "ALL OF" : node.type === "or" ? "ONE OF" : `${n} OF`;

  return (
    <div className="space-y-1">
      <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="ml-1 space-y-1.5 border-l border-border/70 pl-3">
        {node.children.map((child, index) => (
          <div key={index}>
            <PrereqBranch
              node={child}
              graph={graph}
              onOpenCourse={onOpenCourse}
              visited={visited}
              depth={depth}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ExpandableCourse({
  code,
  minGrade,
  graph,
  onOpenCourse,
  visited,
  depth,
}: {
  code: string;
  minGrade?: number | undefined;
  graph: RequisiteGraph;
  onOpenCourse: ((code: string) => void) | undefined;
  visited: Set<string>;
  depth: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const node = graph.nodes.get(code);
  const prereq = node?.requisites.prereq ?? null;

  const cyclic = visited.has(code);
  const atMaxDepth = depth + 1 >= MAX_DEPTH;
  const expandable =
    !cyclic &&
    node?.inCatalog === true &&
    prereq !== null &&
    prereq.confidence !== "none" &&
    prereq.root !== null;

  const chip = (
    <CourseChip
      code={code}
      minGrade={minGrade}
      graph={graph}
      onOpenCourse={onOpenCourse}
    />
  );

  if (!expandable) {
    return <div className="inline-flex items-center gap-1">{chip}</div>;
  }

  if (atMaxDepth) {
    return (
      <div className="inline-flex items-center gap-1">
        {chip}
        <span className="text-xs text-muted-foreground" title="Tree truncated">
          …
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="inline-flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-expanded={expanded}
          aria-label={expanded ? `Collapse ${code} prerequisites` : `Expand ${code} prerequisites`}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        {chip}
      </div>
      {expanded && prereq?.root && (
        <div className="ml-2 border-l border-border/70 pl-3">
          <PrereqBranch
            node={prereq.root}
            graph={graph}
            onOpenCourse={onOpenCourse}
            visited={new Set(visited).add(code)}
            depth={depth + 1}
          />
        </div>
      )}
    </div>
  );
}

function RequiredBy({
  dependents,
  graph,
  onOpenCourse,
}: {
  dependents: string[];
  graph: RequisiteGraph;
  onOpenCourse: ((code: string) => void) | undefined;
}) {
  const [expanded, setExpanded] = React.useState(false);

  if (dependents.length === 0) {
    return null;
  }

  const capped = expanded ? dependents : dependents.slice(0, DIRECT_DEPENDENT_CAP);
  const remaining = dependents.length - capped.length;

  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold text-muted-foreground">
        Required by ({dependents.length})
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {capped.map((depCode) => (
          <CourseChip
            key={depCode}
            code={depCode}
            graph={graph}
            onOpenCourse={onOpenCourse}
          />
        ))}
        {remaining > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => setExpanded(true)}
          >
            +{remaining} more
          </Button>
        )}
      </div>
    </div>
  );
}

/** Direct courses that require `code` as a prerequisite (deduped, sorted). */
function directPrereqDependents(graph: RequisiteGraph, code: string): string[] {
  const edges = graph.edgesFrom.get(code) ?? [];
  const seen = new Set<string>();

  for (const edge of edges) {
    if (edge.kind === "prereq") {
      seen.add(edge.to);
    }
  }

  return [...seen].sort((a, b) => a.localeCompare(b));
}
