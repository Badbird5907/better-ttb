import type { Section, TeachMethod } from "@better-ttb/shared";
import { selectionSatisfiesLinkage } from "@better-ttb/shared";

import { conflictsBetweenSections, meetingsConflict } from "./conflicts";
import {
  buildEvaluationContext,
  evaluateRules,
  scoreMetrics,
  violatesHardRules,
} from "./rules";
import type {
  CandidateTimetable,
  CourseInput,
  GenerationResult,
  GeneratorConfig,
  RuleMetric,
  SelectedSection,
  Selection,
} from "./types";
import {
  activeMeetings,
  isCancelled,
  termsForSectionCode,
} from "./time";

interface CoursePlan {
  inputIndex: number;
  courseCode: string;
  sectionCode: CourseInput["course"]["sectionCode"];
  choices: CourseChoice[];
}

interface CourseChoice {
  key: string;
  selectedSections: SelectedSection[];
}

const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MAX_COMBINATIONS = 500_000;
const TEACH_METHOD_ORDER = new Map<string, number>([
  ["LEC", 0],
  ["TUT", 1],
  ["PRA", 2],
]);

export function generate(
  courses: readonly CourseInput[],
  config: GeneratorConfig,
): GenerationResult {
  const maxResults = normalizePositiveInteger(config.maxResults, DEFAULT_MAX_RESULTS);
  const maxCombinations = normalizeNonNegativeInteger(
    config.maxCombinations,
    DEFAULT_MAX_COMBINATIONS,
  );
  const plans = courses.map((courseInput, index) => buildCoursePlan(courseInput, index));
  const stats = {
    enumerated: 0,
    pruned: 0,
    feasible: 0,
    exhaustive: true,
  };
  const impossiblePlan = plans.find((plan) => plan.choices.length === 0);

  if (impossiblePlan) {
    return {
      candidates: [],
      stats,
      infeasible: {
        reason: `No selectable sections for ${impossiblePlan.courseCode}. Check locks, exclusions, cancellations, or sections that must be taken together (linked sections).`,
        conflictingCourses: [impossiblePlan.courseCode],
      },
    };
  }

  const orderedPlans = [...plans].sort(
    (first, second) =>
      first.choices.length - second.choices.length || first.inputIndex - second.inputIndex,
  );
  const candidates: CandidateTimetable[] = [];
  let stoppedForBudget = false;

  const pushCandidate = (candidate: CandidateTimetable) => {
    candidates.push(candidate);
    candidates.sort(compareCandidates);

    if (candidates.length > maxResults) {
      candidates.pop();
    }
  };

  const dfs = (depth: number, selectedSections: SelectedSection[]) => {
    if (stoppedForBudget) {
      return;
    }

    if (depth === orderedPlans.length) {
      const context = buildEvaluationContext(selectedSections, config.buildings, config.walkSeconds);

      if (violatesHardRules(config.rules, context, { partial: false })) {
        stats.pruned += 1;
        return;
      }

      const metrics = evaluateRules(config.rules, context);
      const candidate = makeCandidate(selectedSections, metrics, scoreMetrics(config.rules, metrics), context.extras);
      stats.feasible += 1;
      pushCandidate(candidate);
      return;
    }

    const plan = orderedPlans[depth];
    if (!plan) {
      return;
    }

    for (const choice of plan.choices) {
      if (stats.enumerated >= maxCombinations) {
        stats.exhaustive = false;
        stoppedForBudget = true;
        return;
      }

      stats.enumerated += 1;

      if (hasConflictBetweenSelections(selectedSections, choice.selectedSections)) {
        stats.pruned += 1;
        continue;
      }

      const nextSelectedSections = [...selectedSections, ...choice.selectedSections];
      const context = buildEvaluationContext(nextSelectedSections, config.buildings, config.walkSeconds);

      if (violatesHardRules(config.rules, context, { partial: true })) {
        stats.pruned += 1;
        continue;
      }

      dfs(depth + 1, nextSelectedSections);
    }
  };

  dfs(0, []);

  candidates.sort(compareCandidates);

  const result: GenerationResult = {
    candidates,
    stats,
  };

  if (candidates.length === 0) {
    const pairwiseHint = findPairwiseInfeasible(plans, config);
    result.infeasible = {
      reason: stoppedForBudget
        ? "Search budget exhausted before finding a feasible timetable."
        : "No feasible timetable found for the selected courses and hard rules.",
      ...(pairwiseHint ? { conflictingCourses: pairwiseHint } : {}),
    };
  }

  return result;
}

function buildCoursePlan(input: CourseInput, inputIndex: number): CoursePlan {
  const excluded = new Set(input.excludedSections ?? []);
  const locked = input.locked ?? {};
  const activeSections = input.course.sections.filter((section) => !isCancelled(section));
  const offeredMethods = new Set(activeSections.map((section) => section.teachMethod));
  const lockedMethods = Object.keys(locked);

  for (const lockedMethod of lockedMethods) {
    if (!offeredMethods.has(lockedMethod)) {
      return emptyCoursePlan(input, inputIndex);
    }
  }

  if (offeredMethods.size === 0) {
    return emptyCoursePlan(input, inputIndex);
  }

  const methods = sortTeachMethods([...offeredMethods]);
  const sectionsByMethod = new Map<TeachMethod, Section[]>();

  for (const method of methods) {
    const lockedSectionName = locked[method];
    const sections = activeSections
      .filter((section) => section.teachMethod === method)
      .filter((section) => !excluded.has(section.name))
      .filter((section) => !lockedSectionName || section.name === lockedSectionName)
      .sort(compareSections);

    if (sections.length === 0) {
      return emptyCoursePlan(input, inputIndex);
    }

    sectionsByMethod.set(method, sections);
  }

  const choices: CourseChoice[] = [];
  const build = (methodIndex: number, sections: Section[]) => {
    if (methodIndex === methods.length) {
      const selectedSections = sections.map((section) => ({
        inputIndex,
        courseCode: input.course.code,
        sectionCode: input.course.sectionCode,
        teachMethod: section.teachMethod,
        section,
      }));

      if (
        !hasConflictWithinSelection(selectedSections) &&
        selectionSatisfiesLinkage(selectedSections.map((s) => s.section))
      ) {
        choices.push({
          key: selectedSections
            .map((selectedSection) => `${selectedSection.teachMethod}:${selectedSection.section.name}`)
            .join("|"),
          selectedSections,
        });
      }

      return;
    }

    const method = methods[methodIndex];
    if (!method) {
      return;
    }

    const methodSections = sectionsByMethod.get(method) ?? [];
    for (const section of methodSections) {
      build(methodIndex + 1, [...sections, section]);
    }
  };

  build(0, []);

  choices.sort((first, second) => first.key.localeCompare(second.key));

  return {
    inputIndex,
    courseCode: input.course.code,
    sectionCode: input.course.sectionCode,
    choices,
  };
}

function emptyCoursePlan(input: CourseInput, inputIndex: number): CoursePlan {
  return {
    inputIndex,
    courseCode: input.course.code,
    sectionCode: input.course.sectionCode,
    choices: [],
  };
}

function hasConflictWithinSelection(selectedSections: readonly SelectedSection[]): boolean {
  for (let firstIndex = 0; firstIndex < selectedSections.length; firstIndex += 1) {
    const first = selectedSections[firstIndex];
    if (!first) {
      continue;
    }

    for (let secondIndex = firstIndex + 1; secondIndex < selectedSections.length; secondIndex += 1) {
      const second = selectedSections[secondIndex];
      if (second && selectedSectionsConflict(first, second)) {
        return true;
      }
    }
  }

  return false;
}

function hasConflictBetweenSelections(
  existing: readonly SelectedSection[],
  added: readonly SelectedSection[],
): boolean {
  if (hasConflictWithinSelection(added)) {
    return true;
  }

  for (const existingSection of existing) {
    for (const addedSection of added) {
      if (selectedSectionsConflict(existingSection, addedSection)) {
        return true;
      }
    }
  }

  return false;
}

function selectedSectionsConflict(first: SelectedSection, second: SelectedSection): boolean {
  if (!termsIntersect(first.sectionCode, second.sectionCode)) {
    return false;
  }

  if (activeMeetings(first.section).length === 0 || activeMeetings(second.section).length === 0) {
    return false;
  }

  return conflictsBetweenSections(first.section, second.section).length > 0;
}

function termsIntersect(
  firstSectionCode: CourseInput["course"]["sectionCode"],
  secondSectionCode: CourseInput["course"]["sectionCode"],
): boolean {
  const firstTerms = new Set(termsForSectionCode(firstSectionCode));
  return termsForSectionCode(secondSectionCode).some((term) => firstTerms.has(term));
}

function makeCandidate(
  selectedSections: readonly SelectedSection[],
  metrics: RuleMetric[],
  score: number,
  extras: CandidateTimetable["extras"],
): CandidateTimetable {
  const selections: Selection[] = [...selectedSections]
    .sort(compareSelectedSections)
    .map((selectedSection) => ({
      courseCode: selectedSection.courseCode,
      teachMethod: selectedSection.teachMethod,
      sectionName: selectedSection.section.name,
    }));

  return {
    selections,
    score,
    metrics,
    extras,
  };
}

function findPairwiseInfeasible(
  plans: readonly CoursePlan[],
  config: GeneratorConfig,
): string[] | null {
  for (const plan of plans) {
    const hasSingleFeasibleChoice = plan.choices.some((choice) => {
      const context = buildEvaluationContext(choice.selectedSections, config.buildings, config.walkSeconds);
      return !violatesHardRules(config.rules, context, { partial: false });
    });

    if (!hasSingleFeasibleChoice) {
      return [plan.courseCode];
    }
  }

  for (let firstIndex = 0; firstIndex < plans.length; firstIndex += 1) {
    const first = plans[firstIndex];
    if (!first) {
      continue;
    }

    for (let secondIndex = firstIndex + 1; secondIndex < plans.length; secondIndex += 1) {
      const second = plans[secondIndex];
      if (!second) {
        continue;
      }

      let compatible = false;

      for (const firstChoice of first.choices) {
        for (const secondChoice of second.choices) {
          if (hasConflictBetweenSelections(firstChoice.selectedSections, secondChoice.selectedSections)) {
            continue;
          }

          const selectedSections = [
            ...firstChoice.selectedSections,
            ...secondChoice.selectedSections,
          ];
          const context = buildEvaluationContext(selectedSections, config.buildings, config.walkSeconds);

          if (!violatesHardRules(config.rules, context, { partial: false })) {
            compatible = true;
            break;
          }
        }

        if (compatible) {
          break;
        }
      }

      if (!compatible) {
        return [first.courseCode, second.courseCode];
      }
    }
  }

  return null;
}

function compareCandidates(first: CandidateTimetable, second: CandidateTimetable): number {
  return second.score - first.score || candidateKey(first).localeCompare(candidateKey(second));
}

function candidateKey(candidate: CandidateTimetable): string {
  return candidate.selections
    .map((selection) => `${selection.courseCode}:${selection.teachMethod}:${selection.sectionName}`)
    .join("|");
}

function compareSelectedSections(first: SelectedSection, second: SelectedSection): number {
  return (
    first.inputIndex - second.inputIndex ||
    compareTeachMethods(first.teachMethod, second.teachMethod) ||
    first.section.name.localeCompare(second.section.name)
  );
}

function compareSections(first: Section, second: Section): number {
  return (
    compareTeachMethods(first.teachMethod, second.teachMethod) ||
    first.name.localeCompare(second.name)
  );
}

function sortTeachMethods(methods: TeachMethod[]): TeachMethod[] {
  return [...methods].sort(compareTeachMethods);
}

function compareTeachMethods(first: TeachMethod, second: TeachMethod): number {
  const firstRank = TEACH_METHOD_ORDER.get(first) ?? 100;
  const secondRank = TEACH_METHOD_ORDER.get(second) ?? 100;

  return firstRank - secondRank || first.localeCompare(second);
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}

export function sectionsHaveMeetingConflict(first: Section, second: Section): boolean {
  for (const firstMeeting of activeMeetings(first)) {
    for (const secondMeeting of activeMeetings(second)) {
      if (meetingsConflict(firstMeeting, secondMeeting)) {
        return true;
      }
    }
  }

  return false;
}

