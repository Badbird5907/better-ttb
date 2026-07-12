import type {
  Course,
  DayNumber,
  DeliveryMode,
  Section,
  TeachMethod,
} from "@better-ttb/shared";

export type RuleMode = "hard" | "soft";
export type Term = "fall" | "winter";

export interface Coordinates {
  lat: number;
  lng: number;
}

interface RuleBase<TKind extends string> {
  id: string;
  kind: TKind;
  mode: RuleMode;
  weight: number;
}

export interface MaxGapRuleConfig extends RuleBase<"max-gap"> {
  maxGapMinutes: number;
}

export interface MaxWalkRuleConfig extends RuleBase<"max-walk"> {
  maxWalkMinutes: number;
}

export interface BlockedTimesRuleConfig extends RuleBase<"blocked-times"> {
  windows: Array<{
    day: DayNumber;
    startMillis: number;
    endMillis: number;
  }>;
}

export interface EarliestStartRuleConfig extends RuleBase<"earliest-start"> {
  millisofday: number;
}

export interface LatestEndRuleConfig extends RuleBase<"latest-end"> {
  millisofday: number;
}

export interface DaysOffRuleConfig extends RuleBase<"days-off"> {
  count?: number;
  days?: DayNumber[];
}

export interface CompactnessRuleConfig extends RuleBase<"compactness"> {
  preference: "compact" | "spread";
}

export interface LunchBreakRuleConfig extends RuleBase<"lunch-break"> {
  startMillis: number;
  endMillis: number;
  minMinutes: number;
}

export interface AvoidFullSectionsRuleConfig
  extends RuleBase<"avoid-full-sections"> {}

export interface AvoidWaitlistRuleConfig extends RuleBase<"avoid-waitlist"> {}

export interface PreferDeliveryRuleConfig extends RuleBase<"prefer-delivery"> {
  modes: DeliveryMode[];
}

export interface PreferInstructorRuleConfig extends RuleBase<"prefer-instructor"> {
  names: string[];
}

export type RuleConfig =
  | MaxGapRuleConfig
  | MaxWalkRuleConfig
  | BlockedTimesRuleConfig
  | EarliestStartRuleConfig
  | LatestEndRuleConfig
  | DaysOffRuleConfig
  | CompactnessRuleConfig
  | LunchBreakRuleConfig
  | AvoidFullSectionsRuleConfig
  | AvoidWaitlistRuleConfig
  | PreferDeliveryRuleConfig
  | PreferInstructorRuleConfig;

export interface CourseInput {
  course: Course;
  locked?: Partial<Record<TeachMethod, string>>;
  excludedSections?: string[];
}

export interface GeneratorConfig {
  rules: RuleConfig[];
  maxResults?: number;
  maxCombinations?: number;
  buildings?: Record<string, Coordinates>;
  /**
   * Real pedestrian walking durations between buildings as a flat
   * `"FROM|TO" -> seconds` map (see `WalkSecondsMap` in `@better-ttb/shared`).
   * When present, back-to-back walk feasibility prefers these durations and
   * falls back to the haversine `walkMinutes` estimate for unknown pairs.
   */
  walkSeconds?: Record<string, number>;
}

export interface Selection {
  courseCode: string;
  teachMethod: TeachMethod;
  sectionName: string;
}

export interface RuleMetric {
  ruleId: string;
  penalty: number;
  detail: string;
}

export interface TightTransfer {
  day: DayNumber;
  from: string;
  to: string;
  gapMin: number;
  walkMin: number;
}

export interface CandidateExtras {
  totalWalkMinutesPerDay: Record<DayNumber, number>;
  tightTransfers: TightTransfer[];
  daysOnCampus: {
    fall: DayNumber[];
    winter: DayNumber[];
  };
  earliestStart: number | null;
  latestEnd: number | null;
}

export interface CandidateTimetable {
  selections: Selection[];
  score: number;
  metrics: RuleMetric[];
  extras: CandidateExtras;
}

export interface GenerationStats {
  enumerated: number;
  pruned: number;
  feasible: number;
  exhaustive: boolean;
}

export interface GenerationResult {
  candidates: CandidateTimetable[];
  stats: GenerationStats;
  infeasible?: {
    reason: string;
    conflictingCourses?: string[];
  };
}

export interface TimetableConflict {
  day: DayNumber;
  first: string;
  second: string;
  startMillis: number;
  endMillis: number;
}

export interface SelectedSection {
  inputIndex: number;
  courseCode: string;
  sectionCode: Course["sectionCode"];
  teachMethod: TeachMethod;
  section: Section;
}

