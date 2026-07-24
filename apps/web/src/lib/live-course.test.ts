import type { Course, TtbCourseLookupResponse } from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import { csc108Course } from "@/server/__fixtures__/ttb-pageable-csc108";
import { extractLiveCourse } from "./live-course";

describe("extractLiveCourse", () => {
  it("selects the exact offering id when multiple sessions share a section code", () => {
    const summer = offering("summer-id", ["20265S"], 28, 34);
    const winter = offering("winter-id", ["20271"], 36, 36);
    const response = lookupResponse([summer, winter]);

    expect(extractLiveCourse(response, winter)).toBe(winter);
  });

  it("falls back to an exact session match when the offering id changes", () => {
    const base = offering("old-winter-id", ["20271"], 30, 36);
    const summer = offering("summer-id", ["20265S"], 28, 34);
    const winter = offering("new-winter-id", ["20271"], 36, 36);

    expect(extractLiveCourse(lookupResponse([summer, winter]), base)).toBe(winter);
  });

  it("returns null instead of guessing when the matching offering is ambiguous", () => {
    const base = offering("missing-id", ["20271"], 30, 36);
    const first = offering("winter-a", ["20271"], 35, 36);
    const second = offering("winter-b", ["20271"], 36, 36);

    expect(extractLiveCourse(lookupResponse([first, second]), base)).toBeNull();
  });
});

function offering(
  id: string,
  sessions: string[],
  currentEnrolment: number,
  maxEnrolment: number,
): Course {
  const course = structuredClone(csc108Course) as Course;
  course.id = id;
  course.code = "PHY132H1";
  course.sectionCode = "S";
  course.sessions = sessions;
  course.sections = [
    {
      ...course.sections[0]!,
      name: "PRA0101",
      teachMethod: "PRA",
      sectionNumber: "0101",
      currentEnrolment,
      maxEnrolment,
    },
  ];
  return course;
}

function lookupResponse(courses: Course[]): TtbCourseLookupResponse {
  return {
    payload: {
      pageableCourse: {
        courses,
        total: courses.length,
        page: 1,
        pageSize: 20,
        direction: "asc",
      },
    },
    status: [],
  };
}
