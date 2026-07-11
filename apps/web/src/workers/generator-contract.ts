import { generate, type CourseInput, type GenerationResult, type GeneratorConfig } from "@better-ttb/generator";

export interface GeneratorWorkerRequest {
  type: "generate";
  id: string;
  courses: CourseInput[];
  config: GeneratorConfig;
}

export interface GeneratorWorkerStartedMessage {
  type: "started";
  id: string;
}

export interface GeneratorWorkerDoneMessage {
  type: "done";
  id: string;
  result: GenerationResult;
}

export interface GeneratorWorkerErrorMessage {
  type: "error";
  id: string;
  message: string;
}

export type GeneratorWorkerMessage =
  | GeneratorWorkerStartedMessage
  | GeneratorWorkerDoneMessage
  | GeneratorWorkerErrorMessage;

export function runGeneratorRequest(
  request: GeneratorWorkerRequest,
): GenerationResult {
  return generate(request.courses, request.config);
}

export function createStartedMessage(
  request: GeneratorWorkerRequest,
): GeneratorWorkerStartedMessage {
  return {
    type: "started",
    id: request.id,
  };
}

export function createDoneMessage(
  request: GeneratorWorkerRequest,
): GeneratorWorkerDoneMessage {
  return {
    type: "done",
    id: request.id,
    result: runGeneratorRequest(request),
  };
}

export function createErrorMessage(
  request: Pick<GeneratorWorkerRequest, "id">,
  error: unknown,
): GeneratorWorkerErrorMessage {
  return {
    type: "error",
    id: request.id,
    message: error instanceof Error ? error.message : String(error),
  };
}

export function isGeneratorWorkerRequest(
  value: unknown,
): value is GeneratorWorkerRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "generate" &&
    typeof (value as { id?: unknown }).id === "string" &&
    Array.isArray((value as { courses?: unknown }).courses) &&
    typeof (value as { config?: unknown }).config === "object" &&
    (value as { config?: unknown }).config !== null
  );
}
