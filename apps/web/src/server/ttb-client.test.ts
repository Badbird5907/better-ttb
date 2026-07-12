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

    expect(result.pageableCourse.courses).toHaveLength(1);
    expect(result.pageableCourse.courses[0]?.code).toBe("CSC108H1");
    expect(result.divisionalEnrolmentIndicators).toEqual({});
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

    expect(result.pageableCourse).toMatchObject({
      courses: [],
      total: 0,
      page: 5,
      pageSize: 20,
    });
    expect(result.divisionalEnrolmentIndicators).toEqual({});
  });

  it("parses divisionalEnrolmentIndicators from the response payload", async () => {
    const response = {
      payload: {
        pageableCourse: csc108PageableResponse.payload?.pageableCourse,
        divisionalEnrolmentIndicators: {
          ARTSC: [
            { code: "P", name: "Priority enrolment until July 22." },
            { code: "E", name: "Open enrolment." },
          ],
        },
      },
      status: [],
    };
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const result = await getPageableCourses(
      buildPageableCoursesBody({ searchTerm: "CSC108", sessions: ["20269"] }),
      { fetchImpl },
    );

    expect(result.divisionalEnrolmentIndicators).toEqual({
      ARTSC: [
        { code: "P", name: "Priority enrolment until July 22." },
        { code: "E", name: "Open enrolment." },
      ],
    });
  });

  it("filters malformed enrolment-indicator entries and divisions", async () => {
    const response = {
      payload: {
        pageableCourse: csc108PageableResponse.payload?.pageableCourse,
        divisionalEnrolmentIndicators: {
          ARTSC: [
            { code: "P", name: "Priority enrolment." },
            { code: 5, name: "bad code" },
            { code: "E" },
            "not-an-object",
          ],
          APSC: "not-an-array",
          EMPTY: [{ name: "no code" }],
        },
      },
      status: [],
    };
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const result = await getPageableCourses(
      buildPageableCoursesBody({ searchTerm: "CSC108", sessions: ["20269"] }),
      { fetchImpl },
    );

    expect(result.divisionalEnrolmentIndicators).toEqual({
      ARTSC: [{ code: "P", name: "Priority enrolment." }],
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
