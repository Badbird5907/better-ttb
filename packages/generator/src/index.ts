export type {
  CandidateExtras,
  CandidateTimetable,
  Coordinates,
  CourseInput,
  GenerationResult,
  GenerationStats,
  GeneratorConfig,
  RuleConfig,
  RuleMetric,
  Selection,
  TightTransfer,
  TimetableConflict,
} from "./types";
export { detectConflicts } from "./conflicts";
export { generate } from "./engine";
export { walkMinutes, minutesToMillis } from "./time";

export const DEFAULT_RULES = [
  {
    id: "max-gap",
    kind: "max-gap",
    mode: "soft",
    weight: 0.5,
    maxGapMinutes: 120,
  },
  {
    id: "avoid-waitlist",
    kind: "avoid-waitlist",
    mode: "soft",
    weight: 0.3,
  },
  {
    id: "earliest-start",
    kind: "earliest-start",
    mode: "soft",
    weight: 0.2,
    millisofday: 9 * 60 * 60 * 1000,
  },
] satisfies import("./types").RuleConfig[];
