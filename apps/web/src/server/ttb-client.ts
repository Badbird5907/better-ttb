import type {
  DivisionalEnrolmentIndicator,
  DivisionalEnrolmentIndicators,
  TtbCourseLookupResponse,
  TtbCourseSearchBody,
  TtbPageableCourse,
  TtbPageableCoursesResponse,
  TtbReferenceDataResponse,
} from "@better-ttb/shared";

const TTB_BASE_URL = "https://api.easi.utoronto.ca/ttb";
export const TTB_PAGE_SIZE = 20;

export interface TtbClientOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export interface BuildPageableCoursesBodyOptions {
  searchTerm?: string;
  sessions: string[];
  divisions?: string[];
  page?: number;
}

export class TtbApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(message);
    this.name = "TtbApiError";
  }
}

export function buildPageableCoursesBody(
  options: BuildPageableCoursesBodyOptions,
): TtbCourseSearchBody {
  const searchTerm = options.searchTerm ?? "";

  return {
    courseCodeAndTitleProps: {
      courseCode: searchTerm,
      courseTitle: searchTerm,
      courseSectionCode: "",
      searchCourseDescription: true,
    },
    departmentProps: [],
    campuses: [],
    sessions: options.sessions,
    requirementProps: [],
    instructor: "",
    courseLevels: [],
    deliveryModes: [],
    dayPreferences: [],
    timePreferences: [],
    divisions: options.divisions ?? ["ARTSC"],
    creditWeights: [],
    availableSpace: false,
    waitListable: false,
    page: normalizePage(options.page),
    pageSize: TTB_PAGE_SIZE,
    direction: "asc",
  };
}

export interface PageableCoursesResult {
  pageableCourse: TtbPageableCourse;
  divisionalEnrolmentIndicators: DivisionalEnrolmentIndicators;
}

export async function getPageableCourses(
  body: TtbCourseSearchBody,
  options: TtbClientOptions = {},
): Promise<PageableCoursesResult> {
  const requestBody = normalizePageableCoursesBody(body);
  const responseBody = await requestJson<TtbPageableCoursesResponse>(
    `${getBaseUrl(options)}/getPageableCourses`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    options,
  );

  if (responseBody === null) {
    return {
      pageableCourse: emptyPageableCourse(requestBody),
      divisionalEnrolmentIndicators: {},
    };
  }

  return parsePageableCoursesResponse(responseBody, requestBody);
}

export async function getCoursesByCode(
  code: string,
  sectionCode?: string,
  options: TtbClientOptions = {},
): Promise<TtbCourseLookupResponse | null> {
  const url = new URL(
    `${getBaseUrl(options)}/getCoursesByCodeAndSectionCode/${encodeURIComponent(
      code,
    )}`,
  );

  if (sectionCode) {
    url.searchParams.set("sectionCode", sectionCode);
  }

  return await requestJson<TtbCourseLookupResponse>(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
      },
    },
    options,
  );
}

export async function getReferenceData(
  options: TtbClientOptions = {},
): Promise<TtbReferenceDataResponse> {
  const responseBody = await requestJson<TtbReferenceDataResponse>(
    `${getBaseUrl(options)}/reference-data`,
    {
      headers: {
        Accept: "application/json",
      },
    },
    options,
  );

  if (responseBody === null) {
    throw new TtbApiError("Reference data unexpectedly returned no results", 404, null);
  }

  return responseBody;
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  options: TtbClientOptions,
): Promise<T | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, init);
  const responseBody = await readJson(response);

  if (isNoResults(response.status, responseBody)) {
    return null;
  }

  if (!response.ok) {
    throw new TtbApiError(
      `TTB request failed with HTTP ${response.status}`,
      response.status,
      responseBody,
    );
  }

  return responseBody as T;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new TtbApiError(
      "TTB returned invalid JSON",
      response.status,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function parsePageableCoursesResponse(
  response: TtbPageableCoursesResponse,
  requestBody: TtbCourseSearchBody,
): PageableCoursesResult {
  const pageableCourse = response.payload?.pageableCourse;

  if (!pageableCourse) {
    throw new TtbApiError("TTB response missing pageableCourse payload", 200, response);
  }

  return {
    pageableCourse,
    divisionalEnrolmentIndicators: parseDivisionalEnrolmentIndicators(
      response.payload?.divisionalEnrolmentIndicators,
    ),
  };
}

function parseDivisionalEnrolmentIndicators(
  value: unknown,
): DivisionalEnrolmentIndicators {
  if (!isRecord(value)) {
    return {};
  }

  const result: DivisionalEnrolmentIndicators = {};

  for (const [division, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    const indicators = entries.filter(isDivisionalEnrolmentIndicator);

    if (indicators.length > 0) {
      result[division] = indicators;
    }
  }

  return result;
}

function isDivisionalEnrolmentIndicator(
  value: unknown,
): value is DivisionalEnrolmentIndicator {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.name === "string"
  );
}

function normalizePageableCoursesBody(
  body: TtbCourseSearchBody,
): TtbCourseSearchBody {
  const courseCode =
    body.courseCodeAndTitleProps.courseCode ||
    body.courseCodeAndTitleProps.courseTitle ||
    "";

  return {
    ...body,
    courseCodeAndTitleProps: {
      ...body.courseCodeAndTitleProps,
      courseCode,
      courseTitle: courseCode,
    },
    page: normalizePage(body.page),
    pageSize: TTB_PAGE_SIZE,
  };
}

function emptyPageableCourse(body: TtbCourseSearchBody): TtbPageableCourse {
  return {
    courses: [],
    total: 0,
    page: body.page,
    pageSize: TTB_PAGE_SIZE,
    direction: body.direction,
  };
}

function normalizePage(page: number | undefined): number {
  return Math.max(1, Math.floor(page ?? 1));
}

function getBaseUrl(options: TtbClientOptions): string {
  return options.baseUrl ?? TTB_BASE_URL;
}

function isNoResults(status: number, body: unknown): boolean {
  if (status !== 404 || !isRecord(body) || body.payload !== null) {
    return false;
  }

  const responseStatus = body.status;

  return (
    Array.isArray(responseStatus) &&
    responseStatus.some(
      (entry) => isRecord(entry) && Number(entry.code) === 4404,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
