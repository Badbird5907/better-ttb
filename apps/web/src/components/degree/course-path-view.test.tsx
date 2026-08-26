import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Course } from "@better-ttb/shared";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("a", { href: "#" }, children),
}));

import { CoursePathView } from "./course-path-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useCompletedCoursesStore } from "@/stores/completed-courses";
import { getRequisiteGraph } from "@/lib/requisites/use-graph";
import {
  computeUnlockedCourses,
  flattenRequirementRows,
  summarizeRows,
} from "./path-utils";

function course(
  code: string,
  name: string,
  prerequisitesText: string | null,
  corequisitesText: string | null = null,
): Course {
  return {
    id: code,
    code,
    sectionCode: "F",
    name,
    cmCourseInfo: {
      description: null,
      prerequisitesText,
      corequisitesText,
      exclusionsText: null,
      recommendedPreparation: null,
      levelOfInstruction: "undergraduate",
      breadthRequirements: [],
      distributionRequirements: [],
      division: "ARTSC",
    },
  } as unknown as Course;
}

const catalog: Course[] = [
  course("CSC108H1", "Introduction to Computer Programming", null),
  course("CSC148H1", "Introduction to Computer Science", "CSC108H1"),
  course("MAT135H1", "Calculus I(A)", null),
  course("MAT137Y1", "Calculus with Proofs", null),
  course(
    "CSC236H1",
    "Introduction to the Theory of Computation",
    "CSC148H1; MAT135H1/MAT137Y1",
    "STA247H1",
  ),
  course("CSC263H1", "Data Structures and Analysis", "CSC236H1"),
  course("CSC373H1", "Algorithm Design", "CSC236H1, CSC263H1"),
];

describe("CoursePathView", () => {
  it("renders before/after zones without crashing", () => {
    useCompletedCoursesStore.setState({ courses: { CSC108H1: 88 } });

    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(CoursePathView, {
          code: "CSC236H1",
          courses: catalog,
        }),
      ),
    );

    expect(html).toContain("CSC236H1");
    expect(html).toContain("Before you can take");
    expect(html).toContain("unlocks");
    expect(html).toContain("CSC148H1");
    expect(html).toContain("MAT137Y1");
    expect(html).toContain("CSC263H1");
    expect(html).toContain("Take together");
    // Unmet, in-catalog prerequisites offer an inline "what does THAT need"
    // toggle; leaf courses without prerequisites do not.
    expect(html).toContain("Show prerequisites for CSC148H1");
    expect(html).not.toContain("Show prerequisites for MAT135H1");
  });

  it("summarizes rows and unlocks against completed courses", () => {
    const graph = getRequisiteGraph(catalog);
    const rows = flattenRequirementRows(
      graph.nodes.get("CSC236H1")?.requisites.prereq?.root ?? null,
    );

    expect(rows).toHaveLength(2);
    expect(summarizeRows(rows, {})).toEqual({
      total: 2,
      satisfied: 0,
      unverified: 0,
    });
    expect(
      summarizeRows(rows, { CSC148H1: null, MAT137Y1: null }),
    ).toEqual({ total: 2, satisfied: 2, unverified: 0 });

    const unlocked = computeUnlockedCourses(graph, "CSC236H1", {
      CSC148H1: null,
    });

    expect(unlocked.map((entry) => [entry.code, entry.status])).toEqual([
      ["CSC263H1", "readyAfter"],
      ["CSC373H1", "blocked"],
    ]);

    // CSC373H1 needs CSC263H1 too, so it stays blocked; once both are done it
    // flips to "ready".
    const withBoth = computeUnlockedCourses(graph, "CSC236H1", {
      CSC236H1: null,
      CSC263H1: null,
    });

    expect(
      withBoth.find((entry) => entry.code === "CSC373H1")?.status,
    ).toBe("ready");
  });
});
