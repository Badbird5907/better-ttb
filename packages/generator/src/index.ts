import type { Course, Section } from "@better-ttb/shared";

export interface GeneratorRule {
  id: string;
  label: string;
  enabled: boolean;
}

export interface GeneratorConfig {
  courses: Course[];
  rules: GeneratorRule[];
}

export interface CandidateTimetable {
  sections: Section[];
  score: number;
}

export function generate(_config: GeneratorConfig): CandidateTimetable[] {
  // TODO: implement timetable generation engine.
  return [];
}
