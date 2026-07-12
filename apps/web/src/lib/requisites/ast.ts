export type ReqNode =
  | { type: "course"; code: string; minGrade?: number } // minGrade = percent, e.g. 70
  | { type: "and"; children: ReqNode[] }
  | { type: "or"; children: ReqNode[] }
  | { type: "nOf"; n: number; children: ReqNode[] }
  | { type: "credits"; raw: string } // e.g. "1.5 credits of 300+ level CSC courses"
  | { type: "text"; text: string }; // free-text leaf

export type ParseConfidence = "full" | "partial" | "none";

export interface ParsedRequisite {
  root: ReqNode | null; // null = no requirement listed
  confidence: ParseConfidence; // "none" => UI must fall back to raw HTML
  notes: string[]; // stripped "Note:" sentences + secondary audience paragraphs
  courseCodes: string[]; // ALL unique course codes found anywhere in the blob
}

export type GroupNode = Extract<ReqNode, { type: "and" | "or" | "nOf" }>;

export function isGroupNode(node: ReqNode): node is GroupNode {
  return node.type === "and" || node.type === "or" || node.type === "nOf";
}

export function isCourseNode(
  node: ReqNode,
): node is Extract<ReqNode, { type: "course" }> {
  return node.type === "course";
}

export function isAndNode(node: ReqNode): node is Extract<ReqNode, { type: "and" }> {
  return node.type === "and";
}

export function isOrNode(node: ReqNode): node is Extract<ReqNode, { type: "or" }> {
  return node.type === "or";
}

export function isNOfNode(node: ReqNode): node is Extract<ReqNode, { type: "nOf" }> {
  return node.type === "nOf";
}

export function isCreditsNode(
  node: ReqNode,
): node is Extract<ReqNode, { type: "credits" }> {
  return node.type === "credits";
}

export function isTextNode(
  node: ReqNode,
): node is Extract<ReqNode, { type: "text" }> {
  return node.type === "text";
}

/** Collect every course code referenced by an AST (deduped, traversal order). */
export function collectCourseCodes(node: ReqNode | null): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();

  const walk = (current: ReqNode): void => {
    if (isCourseNode(current)) {
      if (!seen.has(current.code)) {
        seen.add(current.code);
        codes.push(current.code);
      }
      return;
    }

    if (isGroupNode(current)) {
      current.children.forEach(walk);
    }
  };

  if (node) {
    walk(node);
  }

  return codes;
}

/** True when the AST contains at least one free-text leaf. */
export function containsTextLeaf(node: ReqNode | null): boolean {
  if (!node) {
    return false;
  }

  if (isTextNode(node)) {
    return true;
  }

  return isGroupNode(node) && node.children.some(containsTextLeaf);
}

/** True when the AST contains at least one course or credits leaf. */
export function containsStructuralLeaf(node: ReqNode | null): boolean {
  if (!node) {
    return false;
  }

  if (isCourseNode(node) || isCreditsNode(node)) {
    return true;
  }

  return isGroupNode(node) && node.children.some(containsStructuralLeaf);
}
