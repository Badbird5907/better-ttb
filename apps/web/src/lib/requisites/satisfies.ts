import type { ReqNode } from "./ast";

export type ReqStatus = "met" | "unmet" | "unknown";
export type CompletedCourses = Readonly<Record<string, number | null>>;

export function courseStatus(
  code: string,
  minGrade: number | undefined,
  completed: CompletedCourses,
): ReqStatus {
  const normalizedCode = code.trim().toUpperCase();

  if (!Object.prototype.hasOwnProperty.call(completed, normalizedCode)) {
    return "unmet";
  }

  const grade = completed[normalizedCode] ?? null;

  if (minGrade === undefined) {
    return "met";
  }

  if (grade === null) {
    return "unknown";
  }

  return grade >= minGrade ? "met" : "unmet";
}

export function evaluateReq(
  node: ReqNode | null,
  completed: CompletedCourses,
): ReqStatus {
  if (node === null) {
    return "unknown";
  }

  if (node.type === "course") {
    return courseStatus(node.code, node.minGrade, completed);
  }

  if (node.type === "credits" || node.type === "text") {
    return "unknown";
  }

  const childStatuses = node.children.map((child) =>
    evaluateReq(child, completed),
  );

  if (node.type === "and") {
    if (childStatuses.every((status) => status === "met")) {
      return "met";
    }

    if (childStatuses.some((status) => status === "unmet")) {
      return "unmet";
    }

    return "unknown";
  }

  if (node.type === "or") {
    if (childStatuses.some((status) => status === "met")) {
      return "met";
    }

    if (childStatuses.every((status) => status === "unmet")) {
      return "unmet";
    }

    return "unknown";
  }

  const metCount = childStatuses.filter((status) => status === "met").length;

  if (metCount >= node.n) {
    return "met";
  }

  const unknownCount = childStatuses.filter(
    (status) => status === "unknown",
  ).length;

  return metCount + unknownCount < node.n ? "unmet" : "unknown";
}
