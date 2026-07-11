import { describe, expect, it } from "vitest";

import {
  buildPageableCoursesBody,
  getCoursesByCode,
  getPageableCourses,
} from "./ttb-client";
import { csc108PageableResponse } from "./__fixtures__/ttb-pageable-csc108";

describe("ttb-client", () => {
  it("normalizes pageable course requests and parses successful responses", async () => {
    const requestBodies: unknown[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as unknown);

      return new Response(JSON.stringify(csc108PageableResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await getPageableCourses(
      buildPageableCoursesBody({
        searchTerm: "CSC108",
        sessions: ["20269"],
        page: 0,
      }),
      { fetchImpl },
    );

    expect(result.courses).toHaveLength(1);
    expect(result.courses[0]?.code).toBe("CSC108H1");
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toMatchObject({
      courseCodeAndTitleProps: {
        courseCode: "CSC108",
        courseTitle: "CSC108",
      },
      page: 1,
      pageSize: 20,
    });
  });

  it("treats the verified 404/4404 no-results shape as an empty page", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          payload: null,
          status: [{ code: 4404, message: "No results found" }],
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );

    const result = await getPageableCourses(
      buildPageableCoursesBody({
        sessions: ["20269"],
        page: 5,
      }),
      { fetchImpl },
    );

    expect(result).toMatchObject({
      courses: [],
      total: 0,
      page: 5,
      pageSize: 20,
    });
  });

  it("returns null for course-code lookups with the verified 404/4404 shape", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          payload: null,
          status: [{ code: 4404, message: "No results found" }],
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );

    await expect(getCoursesByCode("NOPE100H1", undefined, { fetchImpl })).resolves.toBeNull();
  });
});
