import "@xyflow/react/dist/style.css";

import type { Course } from "@better-ttb/shared";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import {
  isCourseNode,
  isCreditsNode,
  isGroupNode,
  isTextNode,
  type ParsedRequisite,
  type ReqNode,
} from "@/lib/requisites/ast";
import {
  ancestors,
  descendants,
  type EdgeKind,
  type RequisiteGraph,
} from "@/lib/requisites/graph";
import { preferredOffering } from "@/lib/requisites/use-graph";
import { cn } from "@/lib/utils";

// elk needs concrete dimensions before it can lay anything out, so every node
// type has a fixed footprint that matches the CSS below.
const COURSE_W = 220;
const COURSE_H = 64;
const GATE_W = 56;
const GATE_H = 30;
const REQ_W = 184;
const REQ_H = 44;

const elk = new ELK();

type GateKind = "and" | "or" | "nOf";

interface CourseNodeData {
  kind: "course";
  code: string;
  name: string;
  credit: string | null;
  inCatalog: boolean;
  isFocus: boolean;
  [key: string]: unknown;
}

interface GateNodeData {
  kind: "gate";
  gate: GateKind;
  label: string;
  [key: string]: unknown;
}

interface ReqNodeData {
  kind: "req";
  text: string;
  [key: string]: unknown;
}

type GraphNodeData = CourseNodeData | GateNodeData | ReqNodeData;
type FlowNode = Node<GraphNodeData>;

interface EdgeData {
  reqKind: EdgeKind;
  [key: string]: unknown;
}
type FlowEdge = Edge<EdgeData>;

export interface PrereqGraphProps {
  graph: RequisiteGraph;
  focusCode: string;
  depth: number;
  kinds: EdgeKind[];
  onFocusCourse: (code: string) => void;
}

export function PrereqGraph(props: PrereqGraphProps) {
  return (
    <ReactFlowProvider>
      <PrereqGraphInner {...props} />
    </ReactFlowProvider>
  );
}

function PrereqGraphInner({
  graph,
  focusCode,
  depth,
  kinds,
  onFocusCourse,
}: PrereqGraphProps) {
  const { fitView } = useReactFlow();
  const [layout, setLayout] = React.useState<{
    nodes: FlowNode[];
    edges: FlowEdge[];
  } | null>(null);

  const raw = React.useMemo(
    () => buildFlowGraph(graph, focusCode, depth, kinds),
    [graph, focusCode, depth, kinds],
  );

  React.useEffect(() => {
    let cancelled = false;

    setLayout(null);
    void runLayout(raw.nodes, raw.edges).then((laid) => {
      if (!cancelled) {
        setLayout(laid);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [raw]);

  // Zoom in on the focused course (plus its immediate neighbours) whenever the
  // focus — and therefore the whole subgraph — changes, rather than fitting the
  // entire (potentially massive) tree.
  React.useEffect(() => {
    if (!layout) {
      return;
    }

    const focusId = courseId(focusCode);
    const neighbourhood = new Set<string>([focusId]);

    for (const edge of layout.edges) {
      if (edge.source === focusId) {
        neighbourhood.add(edge.target);
      } else if (edge.target === focusId) {
        neighbourhood.add(edge.source);
      }
    }

    const targetNodes = layout.nodes.filter((node) =>
      neighbourhood.has(node.id),
    );
    const fitNodes =
      targetNodes.length > 0 ? targetNodes : [{ id: focusId }];

    const handle = window.setTimeout(() => {
      void fitView({
        nodes: fitNodes,
        duration: 400,
        padding: 0.3,
        maxZoom: 1,
      });
    }, 0);

    return () => window.clearTimeout(handle);
  }, [layout, focusCode, fitView]);

  const nodeTypes = React.useMemo<NodeTypes>(
    () => ({
      course: CourseFlowNode,
      gate: GateFlowNode,
      req: ReqFlowNode,
    }),
    [],
  );
  const edgeTypes = React.useMemo<EdgeTypes>(() => ({}), []);

  const handleNodeClick = React.useCallback(
    (_event: React.MouseEvent, node: FlowNode) => {
      if (node.data.kind === "course" && node.data.inCatalog) {
        onFocusCourse(node.data.code);
      }
    },
    [onFocusCourse],
  );

  if (!layout) {
    return (
      <div className="flex h-full w-full flex-col gap-3 p-6">
        <Skeleton className="h-16 w-56" />
        <Skeleton className="ml-24 h-8 w-16" />
        <Skeleton className="h-16 w-56" />
        <Skeleton className="mt-8 h-16 w-56 self-center" />
      </div>
    );
  }

  return (
    <div className="h-full w-full" style={{ background: "var(--background)" }}>
      <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        minZoom={0.1}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: false }}
      >
        <Background color="var(--border)" gap={20} />
        <Controls showInteractive={false} className="!border-border !shadow-sm" />
        <MiniMap
          pannable
          zoomable
          className="!bg-muted !border-border"
          maskColor="var(--background)"
          nodeColor={(node) =>
            (node.data as GraphNodeData | undefined)?.kind === "course"
              ? "var(--primary)"
              : "var(--muted-foreground)"
          }
          nodeStrokeColor="var(--border)"
        />
      </ReactFlow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subgraph construction
// ---------------------------------------------------------------------------

interface RawGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

function buildFlowGraph(
  graph: RequisiteGraph,
  focusCode: string,
  depth: number,
  kinds: EdgeKind[],
): RawGraph {
  const opts =
    depth === Number.POSITIVE_INFINITY ? { kinds } : { depth, kinds };
  const anc = ancestors(graph, focusCode, opts);
  const desc = descendants(graph, focusCode, opts);

  const included = new Set<string>([focusCode, ...anc, ...desc]);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const seenCourse = new Set<string>();
  let gateId = 0;

  const addCourseNode = (code: string): void => {
    if (seenCourse.has(code)) {
      return;
    }
    seenCourse.add(code);

    const node = graph.nodes.get(code);
    const offering = node ? preferredOffering(node.offerings) : null;

    nodes.push({
      id: courseId(code),
      type: "course",
      position: { x: 0, y: 0 },
      data: {
        kind: "course",
        code,
        name: offering?.name ?? code,
        credit: creditLabel(offering),
        inCatalog: node?.inCatalog ?? false,
        isFocus: code === focusCode,
      },
    });
  };

  // Focus + all in-scope courses become course nodes.
  for (const code of included) {
    addCourseNode(code);
  }

  const enabledKinds = new Set(kinds);

  // Ancestor side: render the requisite AST of every in-scope course so that
  // AND/OR gates are visible. We only expand the ASTs for the requisite kinds
  // the user has enabled, and only for courses whose requirement leaves are
  // themselves part of the visible subgraph (or out-of-catalog references).
  for (const code of included) {
    const node = graph.nodes.get(code);

    if (!node || !node.inCatalog) {
      continue;
    }

    for (const kind of ["prereq", "coreq", "recprep"] as EdgeKind[]) {
      if (!enabledKinds.has(kind)) {
        continue;
      }

      const parsed = node.requisites[kind];

      if (!parsed || parsed.confidence === "none" || !parsed.root) {
        continue;
      }

      // Only expand this AST when at least one of its course leaves is in the
      // visible ancestor set for this course; otherwise it belongs to a
      // descendant course further down and would explode the graph.
      if (!astTouchesIncluded(parsed.root, included, code)) {
        continue;
      }

      const emit = renderReqTree(
        parsed.root,
        courseId(code),
        kind,
        included,
        code,
        nodes,
        edges,
        addCourseNode,
        () => `gate-${code}-${kind}-${gateId++}`,
      );

      void emit;
    }
  }

  // Descendant side: plain focus -> dependent edges (labelled with minGrade).
  // For any included course, draw the direct requisite edges to other included
  // courses that we did NOT already express via a gate tree.
  const existingEdges = new Set(edges.map((edge) => edge.id));

  for (const code of included) {
    const outgoing = graph.edgesFrom.get(code) ?? [];

    for (const edge of outgoing) {
      if (!enabledKinds.has(edge.kind) || !included.has(edge.to)) {
        continue;
      }

      const dependentNode = graph.nodes.get(edge.to);

      // If the dependent's AST was expanded into gates above, its direct edges
      // already exist; skip to avoid duplicate/parallel edges.
      if (
        dependentNode?.inCatalog &&
        edgeExpressedByGate(edge.to, edge.kind, existingEdges)
      ) {
        continue;
      }

      const id = directEdgeId(code, edge.to, edge.kind);

      if (existingEdges.has(id)) {
        continue;
      }
      existingEdges.add(id);

      edges.push(
        makeEdge(id, courseId(code), courseId(edge.to), edge.kind, edge.minGrade),
      );
    }
  }

  return { nodes, edges };
}

/**
 * Render a requisite AST as gate + course/req nodes feeding into `targetId`.
 * Collapses trivial single-course requirements to a direct course->course edge
 * (no gate). Returns nothing; mutates the node/edge arrays.
 */
function renderReqTree(
  root: ReqNode,
  targetId: string,
  kind: EdgeKind,
  included: Set<string>,
  ownerCode: string,
  nodes: FlowNode[],
  edges: FlowEdge[],
  addCourseNode: (code: string) => void,
  nextGateId: () => string,
): void {
  // The producer connects into `targetId`. Returns the source node id to wire.
  const walk = (current: ReqNode): string | null => {
    if (isCourseNode(current)) {
      addCourseNode(current.code);
      return courseId(current.code);
    }

    if (isCreditsNode(current)) {
      const id = nextGateId();
      nodes.push(reqFlowNode(id, current.raw));
      return id;
    }

    if (isTextNode(current)) {
      const id = nextGateId();
      nodes.push(reqFlowNode(id, current.text));
      return id;
    }

    if (isGroupNode(current)) {
      const children = current.children;

      // Collapse a single-child group: no gate, just wire the child through.
      if (children.length === 1 && children[0]) {
        return walk(children[0]);
      }

      const gateId = nextGateId();
      nodes.push(gateFlowNode(gateId, current));

      for (const child of children) {
        const childId = walk(child);

        if (childId) {
          edges.push(makeEdge(`${childId}->${gateId}`, childId, gateId, kind));
        }
      }

      return gateId;
    }

    return null;
  };

  const rootSource = walk(root);

  if (rootSource) {
    edges.push(
      makeEdge(`${rootSource}->${targetId}:${kind}`, rootSource, targetId, kind),
    );
  }

  void included;
  void ownerCode;
}

function astTouchesIncluded(
  root: ReqNode,
  included: Set<string>,
  ownerCode: string,
): boolean {
  let touches = false;

  const walk = (node: ReqNode): void => {
    if (touches) {
      return;
    }
    if (isCourseNode(node)) {
      if (node.code !== ownerCode && included.has(node.code)) {
        touches = true;
      }
      return;
    }
    if (isGroupNode(node)) {
      node.children.forEach(walk);
    }
  };

  walk(root);
  return touches;
}

function edgeExpressedByGate(
  toCode: string,
  kind: EdgeKind,
  existingEdges: Set<string>,
): boolean {
  const prefix = `->${courseId(toCode)}:${kind}`;

  for (const id of existingEdges) {
    if (id.endsWith(prefix)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Node/edge factories
// ---------------------------------------------------------------------------

function courseId(code: string): string {
  return `c:${code}`;
}

function directEdgeId(from: string, to: string, kind: EdgeKind): string {
  return `d:${from}->${to}:${kind}`;
}

function reqFlowNode(id: string, text: string): FlowNode {
  return {
    id,
    type: "req",
    position: { x: 0, y: 0 },
    data: { kind: "req", text },
  };
}

function gateFlowNode(id: string, group: Extract<ReqNode, { type: "and" | "or" | "nOf" }>): FlowNode {
  return {
    id,
    type: "gate",
    position: { x: 0, y: 0 },
    data: { kind: "gate", gate: group.type, label: gateLabel(group) },
  };
}

function gateLabel(group: Extract<ReqNode, { type: "and" | "or" | "nOf" }>): string {
  if (group.type === "and") {
    return "ALL";
  }
  if (group.type === "or") {
    return "1 of";
  }
  return `${group.n} of`;
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  kind: EdgeKind,
  minGrade?: number,
): FlowEdge {
  const style =
    kind === "coreq"
      ? { stroke: "var(--muted-foreground)", strokeDasharray: "6 4", strokeWidth: 1.5 }
      : kind === "recprep"
        ? { stroke: "var(--muted-foreground)", strokeDasharray: "2 4", strokeWidth: 1.5, opacity: 0.6 }
        : { stroke: "var(--muted-foreground)", strokeWidth: 1.5 };

  const edge: FlowEdge = {
    id,
    source,
    target,
    type: "default",
    style,
    data: { reqKind: kind },
  };

  if (minGrade !== undefined) {
    edge.label = `\u2265${minGrade}%`;
    edge.labelStyle = { fill: "var(--muted-foreground)", fontSize: 10 };
    edge.labelBgStyle = { fill: "var(--background)" };
  }

  return edge;
}

function creditLabel(course: Course | null): string | null {
  if (!course) {
    return null;
  }

  const credit = course.maxCredit ?? course.minCredit;

  if (typeof credit !== "number" || Number.isNaN(credit)) {
    return null;
  }

  return credit.toFixed(1);
}

// ---------------------------------------------------------------------------
// elk layout
// ---------------------------------------------------------------------------

function dimsFor(type: FlowNode["type"]): { width: number; height: number } {
  if (type === "gate") {
    return { width: GATE_W, height: GATE_H };
  }
  if (type === "req") {
    return { width: REQ_W, height: REQ_H };
  }
  return { width: COURSE_W, height: COURSE_H };
}

async function runLayout(
  nodes: FlowNode[],
  edges: FlowEdge[],
): Promise<RawGraph> {
  const elkNodes: ElkNode["children"] = nodes.map((node) => {
    const dims = dimsFor(node.type);

    return { id: node.id, width: dims.width, height: dims.height };
  });
  const elkEdges = edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
  }));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.spacing.nodeNode": "36",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.edgeRouting": "POLYLINE",
    },
    children: elkNodes,
    edges: elkEdges,
  };

  let result: ElkNode;

  try {
    result = await elk.layout(graph);
  } catch {
    return { nodes, edges };
  }

  const positions = new Map<string, { x: number; y: number }>();

  for (const child of result.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  const laidNodes = nodes.map((node) => {
    const pos = positions.get(node.id);

    return pos
      ? {
          ...node,
          position: pos,
          sourcePosition: Position.Bottom,
          targetPosition: Position.Top,
        }
      : node;
  });

  return { nodes: laidNodes, edges };
}

// ---------------------------------------------------------------------------
// Custom node renderers
// ---------------------------------------------------------------------------

function CourseFlowNode({ data }: NodeProps<FlowNode>) {
  if (data.kind !== "course") {
    return null;
  }

  const dimmed = !data.inCatalog;

  return (
    <div
      title={dimmed ? `${data.code} (not in Arts & Science catalog)` : data.name}
      style={{ width: COURSE_W, height: COURSE_H }}
      className={cn(
        "flex flex-col justify-center gap-0.5 rounded-md border bg-card px-3 py-2 text-card-foreground shadow-sm transition-colors",
        data.isFocus &&
          "border-blue-500 bg-blue-50 ring-2 ring-blue-500 ring-offset-1 ring-offset-background dark:border-blue-400 dark:bg-blue-950/40 dark:ring-blue-400",
        dimmed
          ? "cursor-default border-dashed opacity-40"
          : "cursor-pointer hover:border-ring",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{data.code}</span>
        {data.credit && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {data.credit}
          </span>
        )}
      </div>
      <span className="truncate text-xs text-muted-foreground">{data.name}</span>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

function GateFlowNode({ data }: NodeProps<FlowNode>) {
  if (data.kind !== "gate") {
    return null;
  }

  return (
    <div
      style={{ width: GATE_W, height: GATE_H }}
      className="flex items-center justify-center rounded-full border bg-muted text-[11px] font-semibold text-muted-foreground"
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      {data.label}
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

function ReqFlowNode({ data }: NodeProps<FlowNode>) {
  if (data.kind !== "req") {
    return null;
  }

  return (
    <div
      title={data.text}
      style={{ width: REQ_W, height: REQ_H }}
      className="flex items-center rounded-md border border-dashed bg-muted/50 px-2 py-1 text-[11px] leading-tight text-muted-foreground"
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <span className="line-clamp-2">{data.text}</span>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

// Re-export so tree.tsx can render the "none"-confidence fallback consistently.
export type { ParsedRequisite };
