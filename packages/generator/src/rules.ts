import type { DayNumber, MeetingTime } from "@better-ttb/shared";

import type {
  CandidateExtras,
  Coordinates,
  RuleConfig,
  RuleMetric,
  SelectedSection,
  Term,
  TightTransfer,
} from "./types";
import {
  activeMeetings,
  DAY_NUMBERS,
  formatClock,
  intervalsOverlap,
  isFullSection,
  isWaitlistableSection,
  makeDayRecord,
  meetingEndMinutes,
  meetingStartMinutes,
  millisToMinutes,
  overlapMillis,
  roundMinutes,
  sectionDeliveryModes,
  sectionInstructorText,
  sortDays,
  termsForSectionCode,
  walkMinutes,
} from "./time";

interface ScheduledMeeting {
  term: Term;
  day: DayNumber;
  startMillis: number;
  endMillis: number;
  label: string;
  meeting: MeetingTime;
}

interface Transfer {
  term: Term;
  day: DayNumber;
  from: string;
  to: string;
  gapMin: number;
  walkMin: number | null;
}

export interface EvaluationContext {
  selectedSections: SelectedSection[];
  meetingsByTerm: Record<Term, ScheduledMeeting[]>;
  transfers: Transfer[];
  extras: CandidateExtras;
}

interface HardRuleOptions {
  partial: boolean;
}

const TERMS: Term[] = ["fall", "winter"];
const MAX_REASONABLE_DAY_SPAN_MINUTES = 14 * 60;

export function buildEvaluationContext(
  selectedSections: readonly SelectedSection[],
  buildings?: Record<string, Coordinates>,
): EvaluationContext {
  const meetingsByTerm: Record<Term, ScheduledMeeting[]> = {
    fall: [],
    winter: [],
  };

  for (const selectedSection of selectedSections) {
    const terms = termsForSectionCode(selectedSection.sectionCode);
    const sectionMeetings = activeMeetings(selectedSection.section);

    for (const meeting of sectionMeetings) {
      for (const term of terms) {
        meetingsByTerm[term].push({
          term,
          day: meeting.start.day,
          startMillis: meeting.start.millisofday,
          endMillis: meeting.end.millisofday,
          label: `${selectedSection.courseCode} ${selectedSection.section.name}`,
          meeting,
        });
      }
    }
  }

  for (const term of TERMS) {
    meetingsByTerm[term].sort(compareScheduledMeetings);
  }

  const daysOnCampus = {
    fall: daysForMeetings(meetingsByTerm.fall),
    winter: daysForMeetings(meetingsByTerm.winter),
  };
  const allMeetings = [...meetingsByTerm.fall, ...meetingsByTerm.winter];
  const earliestStart =
    allMeetings.length === 0
      ? null
      : Math.min(...allMeetings.map((meeting) => meeting.startMillis));
  const latestEnd =
    allMeetings.length === 0 ? null : Math.max(...allMeetings.map((meeting) => meeting.endMillis));
  const transfers = buildTransfers(meetingsByTerm, buildings);
  const totalWalkMinutesPerDay = makeDayRecord(0);
  const tightTransfers: TightTransfer[] = [];

  for (const transfer of transfers) {
    if (transfer.walkMin === null) {
      continue;
    }

    totalWalkMinutesPerDay[transfer.day] = roundMinutes(
      totalWalkMinutesPerDay[transfer.day] + transfer.walkMin,
    );

    if (transfer.gapMin <= 30) {
      tightTransfers.push({
        day: transfer.day,
        from: transfer.from,
        to: transfer.to,
        gapMin: roundMinutes(transfer.gapMin),
        walkMin: roundMinutes(transfer.walkMin),
      });
    }
  }

  return {
    selectedSections: [...selectedSections],
    meetingsByTerm,
    transfers,
    extras: {
      totalWalkMinutesPerDay,
      tightTransfers: tightTransfers.sort(compareTightTransfers),
      daysOnCampus,
      earliestStart,
      latestEnd,
    },
  };
}

export function evaluateRules(
  rules: readonly RuleConfig[],
  context: EvaluationContext,
): RuleMetric[] {
  return rules.map((rule) => evaluateRule(rule, context));
}

export function violatesHardRules(
  rules: readonly RuleConfig[],
  context: EvaluationContext,
  options: HardRuleOptions,
): boolean {
  for (const rule of rules) {
    if (rule.mode !== "hard" || shouldSkipHardRule(rule, options)) {
      continue;
    }

    if (evaluateRule(rule, context).penalty > 0) {
      return true;
    }
  }

  return false;
}

export function scoreMetrics(rules: readonly RuleConfig[], metrics: readonly RuleMetric[]): number {
  let totalWeight = 0;
  let weightedPenalty = 0;

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    const metric = metrics[index];

    if (!rule || !metric || rule.mode !== "soft" || rule.weight <= 0) {
      continue;
    }

    totalWeight += rule.weight;
    weightedPenalty += rule.weight * clamp01(metric.penalty);
  }

  if (totalWeight <= 0) {
    return 100;
  }

  return Number((100 * (1 - weightedPenalty / totalWeight)).toFixed(6));
}

function evaluateRule(rule: RuleConfig, context: EvaluationContext): RuleMetric {
  switch (rule.kind) {
    case "max-gap":
      return evaluateMaxGap(rule, context);
    case "max-walk":
      return evaluateMaxWalk(rule, context);
    case "blocked-times":
      return evaluateBlockedTimes(rule, context);
    case "earliest-start":
      return evaluateEarliestStart(rule, context);
    case "latest-end":
      return evaluateLatestEnd(rule, context);
    case "days-off":
      return evaluateDaysOff(rule, context);
    case "compactness":
      return evaluateCompactness(rule, context);
    case "lunch-break":
      return evaluateLunchBreak(rule, context);
    case "avoid-full-sections":
      return evaluateAvoidFullSections(rule, context);
    case "avoid-waitlist":
      return evaluateAvoidWaitlist(rule, context);
    case "prefer-delivery":
      return evaluatePreferDelivery(rule, context);
    case "prefer-instructor":
      return evaluatePreferInstructor(rule, context);
  }
}

function evaluateMaxGap(
  rule: Extract<RuleConfig, { kind: "max-gap" }>,
  context: EvaluationContext,
): RuleMetric {
  const threshold = Math.max(0, rule.maxGapMinutes);
  const gaps: number[] = [];

  for (const term of TERMS) {
    for (const day of DAY_NUMBERS) {
      const meetings = context.meetingsByTerm[term].filter((meeting) => meeting.day === day);

      for (let index = 0; index < meetings.length - 1; index += 1) {
        const current = meetings[index];
        const next = meetings[index + 1];
        if (!current || !next) {
          continue;
        }

        const gap = millisToMinutes(next.startMillis - current.endMillis);
        if (gap > threshold) {
          gaps.push(gap);
        }
      }
    }
  }

  if (gaps.length === 0) {
    return metric(rule.id, 0, `0 gaps > ${threshold}min`);
  }

  const worstGap = Math.max(...gaps);
  const worstExcess = worstGap - threshold;
  const penalty = threshold === 0 ? 1 : clamp01(worstExcess / threshold);

  return metric(
    rule.id,
    penalty,
    `${gaps.length} gaps > ${threshold}min (worst ${Math.round(worstGap)}min)`,
  );
}

function evaluateMaxWalk(
  rule: Extract<RuleConfig, { kind: "max-walk" }>,
  context: EvaluationContext,
): RuleMetric {
  const threshold = Math.max(0, rule.maxWalkMinutes);
  const tightTransfers = context.transfers.filter((transfer) => transfer.gapMin <= 30);
  let overLimit = 0;
  let impossible = 0;
  let worstPenalty = 0;

  for (const transfer of tightTransfers) {
    if (transfer.walkMin === null) {
      continue;
    }

    if (transfer.walkMin > threshold) {
      overLimit += 1;
      worstPenalty = Math.max(
        worstPenalty,
        threshold === 0 ? 1 : (transfer.walkMin - threshold) / threshold,
      );
    }

    if (transfer.walkMin > transfer.gapMin) {
      impossible += 1;
      worstPenalty = Math.max(
        worstPenalty,
        transfer.gapMin <= 0 ? 1 : (transfer.walkMin - transfer.gapMin) / transfer.gapMin,
      );
    }
  }

  if (tightTransfers.length === 0) {
    return metric(rule.id, 0, `0 back-to-back transfers > ${threshold}min`);
  }

  return metric(
    rule.id,
    clamp01(worstPenalty),
    `${overLimit} walks > ${threshold}min, ${impossible} impossible transfers`,
  );
}

function evaluateBlockedTimes(
  rule: Extract<RuleConfig, { kind: "blocked-times" }>,
  context: EvaluationContext,
): RuleMetric {
  let overlapMinutes = 0;
  let overlapCount = 0;
  const windowMinutes = rule.windows.reduce(
    (sum, window) => sum + Math.max(0, millisToMinutes(window.endMillis - window.startMillis)),
    0,
  );

  for (const term of TERMS) {
    for (const meeting of context.meetingsByTerm[term]) {
      for (const window of rule.windows) {
        if (meeting.day !== window.day) {
          continue;
        }

        const overlap = overlapMillis(
          meeting.startMillis,
          meeting.endMillis,
          window.startMillis,
          window.endMillis,
        );

        if (overlap > 0) {
          overlapCount += 1;
          overlapMinutes += millisToMinutes(overlap);
        }
      }
    }
  }

  const penalty = overlapMinutes === 0 ? 0 : windowMinutes === 0 ? 1 : overlapMinutes / windowMinutes;

  return metric(
    rule.id,
    clamp01(penalty),
    `${overlapCount} blocked overlaps (${Math.round(overlapMinutes)}min)`,
  );
}

function evaluateEarliestStart(
  rule: Extract<RuleConfig, { kind: "earliest-start" }>,
  context: EvaluationContext,
): RuleMetric {
  const starts = TERMS.flatMap((term) =>
    context.meetingsByTerm[term].map((meeting) => meeting.startMillis),
  );
  const earlyStarts = starts.filter((start) => start < rule.millisofday);

  if (earlyStarts.length === 0) {
    return metric(rule.id, 0, `no starts before ${formatClock(rule.millisofday)}`);
  }

  const earliest = Math.min(...earlyStarts);
  const excess = millisToMinutes(rule.millisofday - earliest);

  return metric(
    rule.id,
    clamp01(excess / 180),
    `earliest ${formatClock(earliest)} before ${formatClock(rule.millisofday)} by ${Math.round(
      excess,
    )}min`,
  );
}

function evaluateLatestEnd(
  rule: Extract<RuleConfig, { kind: "latest-end" }>,
  context: EvaluationContext,
): RuleMetric {
  const ends = TERMS.flatMap((term) => context.meetingsByTerm[term].map((meeting) => meeting.endMillis));
  const lateEnds = ends.filter((end) => end > rule.millisofday);

  if (lateEnds.length === 0) {
    return metric(rule.id, 0, `no ends after ${formatClock(rule.millisofday)}`);
  }

  const latest = Math.max(...lateEnds);
  const excess = millisToMinutes(latest - rule.millisofday);

  return metric(
    rule.id,
    clamp01(excess / 180),
    `latest ${formatClock(latest)} after ${formatClock(rule.millisofday)} by ${Math.round(
      excess,
    )}min`,
  );
}

function evaluateDaysOff(
  rule: Extract<RuleConfig, { kind: "days-off" }>,
  context: EvaluationContext,
): RuleMetric {
  if (rule.days && rule.days.length > 0) {
    const preferredDays = new Set(rule.days);
    const occupied = TERMS.flatMap((term) =>
      context.extras.daysOnCampus[term].filter((day) => preferredDays.has(day)),
    );
    const uniqueOccupied = sortDays(new Set(occupied));
    const penalty = uniqueOccupied.length / preferredDays.size;

    return metric(
      rule.id,
      clamp01(penalty),
      uniqueOccupied.length === 0
        ? `preferred days free: ${rule.days.join(",")}`
        : `occupied preferred days: ${uniqueOccupied.join(",")}`,
    );
  }

  const target = Math.max(0, rule.count ?? 1);
  const fallFree = DAY_NUMBERS.length - context.extras.daysOnCampus.fall.length;
  const winterFree = DAY_NUMBERS.length - context.extras.daysOnCampus.winter.length;
  const worstShortfall = Math.max(0, target - fallFree, target - winterFree);

  return metric(
    rule.id,
    target === 0 ? 0 : clamp01(worstShortfall / target),
    `fall ${fallFree} free days, winter ${winterFree} free days (target ${target})`,
  );
}

function evaluateCompactness(
  rule: Extract<RuleConfig, { kind: "compactness" }>,
  context: EvaluationContext,
): RuleMetric {
  let totalSpan = 0;

  for (const term of TERMS) {
    for (const day of DAY_NUMBERS) {
      const meetings = context.meetingsByTerm[term].filter((meeting) => meeting.day === day);
      if (meetings.length === 0) {
        continue;
      }

      const firstStart = Math.min(...meetings.map((meeting) => meeting.startMillis));
      const lastEnd = Math.max(...meetings.map((meeting) => meeting.endMillis));
      totalSpan += millisToMinutes(lastEnd - firstStart);
    }
  }

  const maxSpan = TERMS.length * DAY_NUMBERS.length * MAX_REASONABLE_DAY_SPAN_MINUTES;
  const compactPenalty = maxSpan === 0 ? 0 : clamp01(totalSpan / maxSpan);
  const penalty = rule.preference === "compact" ? compactPenalty : clamp01(1 - compactPenalty);

  return metric(
    rule.id,
    penalty,
    `${rule.preference} span ${Math.round(totalSpan)}min`,
  );
}

function evaluateLunchBreak(
  rule: Extract<RuleConfig, { kind: "lunch-break" }>,
  context: EvaluationContext,
): RuleMetric {
  const target = Math.max(0, rule.minMinutes);
  const violations: Array<{ term: Term; day: DayNumber; best: number }> = [];

  for (const term of TERMS) {
    for (const day of DAY_NUMBERS) {
      const busy = context.meetingsByTerm[term]
        .filter(
          (meeting) =>
            meeting.day === day &&
            intervalsOverlap(
              meeting.startMillis,
              meeting.endMillis,
              rule.startMillis,
              rule.endMillis,
            ),
        )
        .map((meeting) => ({
          start: Math.max(meeting.startMillis, rule.startMillis),
          end: Math.min(meeting.endMillis, rule.endMillis),
        }))
        .sort((a, b) => a.start - b.start || a.end - b.end);

      const bestFree = largestFreeBlockMinutes(rule.startMillis, rule.endMillis, busy);
      if (bestFree < target) {
        violations.push({ term, day, best: bestFree });
      }
    }
  }

  if (violations.length === 0) {
    return metric(rule.id, 0, `lunch break >= ${target}min available`);
  }

  const worstShortfall = Math.max(...violations.map((violation) => target - violation.best));

  return metric(
    rule.id,
    target === 0 ? 0 : clamp01(worstShortfall / target),
    `${violations.length} days without ${target}min lunch (worst ${Math.round(
      target - worstShortfall,
    )}min)`,
  );
}

function evaluateAvoidFullSections(
  rule: Extract<RuleConfig, { kind: "avoid-full-sections" }>,
  context: EvaluationContext,
): RuleMetric {
  const fullSections = context.selectedSections.filter((selectedSection) =>
    isFullSection(selectedSection.section),
  );
  const penalty =
    context.selectedSections.length === 0 ? 0 : fullSections.length / context.selectedSections.length;

  return metric(
    rule.id,
    penalty,
    `${fullSections.length} full sections`,
  );
}

function evaluateAvoidWaitlist(
  rule: Extract<RuleConfig, { kind: "avoid-waitlist" }>,
  context: EvaluationContext,
): RuleMetric {
  const waitlistable = context.selectedSections.filter((selectedSection) =>
    isWaitlistableSection(selectedSection.section),
  );
  const penalty =
    context.selectedSections.length === 0 ? 0 : waitlistable.length / context.selectedSections.length;

  return metric(rule.id, penalty, `${waitlistable.length} waitlistable sections`);
}

function evaluatePreferDelivery(
  rule: Extract<RuleConfig, { kind: "prefer-delivery" }>,
  context: EvaluationContext,
): RuleMetric {
  if (rule.modes.length === 0) {
    return metric(rule.id, 0, "no delivery preferences");
  }

  const preferred = new Set(rule.modes);
  const mismatches = context.selectedSections.filter((selectedSection) => {
    const modes = sectionDeliveryModes(selectedSection.section);
    return modes.length > 0 && !modes.some((mode) => preferred.has(mode));
  });
  const penalty =
    context.selectedSections.length === 0 ? 0 : mismatches.length / context.selectedSections.length;

  return metric(rule.id, penalty, `${mismatches.length} sections outside preferred delivery`);
}

function evaluatePreferInstructor(
  rule: Extract<RuleConfig, { kind: "prefer-instructor" }>,
  context: EvaluationContext,
): RuleMetric {
  const needles = rule.names.map((name) => name.trim().toLowerCase()).filter(Boolean);

  if (needles.length === 0) {
    return metric(rule.id, 0, "no instructor preferences");
  }

  const mismatches = context.selectedSections.filter((selectedSection) => {
    const instructorText = sectionInstructorText(selectedSection.section);
    return !needles.some((needle) => instructorText.includes(needle));
  });
  const penalty =
    context.selectedSections.length === 0 ? 0 : mismatches.length / context.selectedSections.length;

  return metric(rule.id, penalty, `${mismatches.length} sections without preferred instructor`);
}

function buildTransfers(
  meetingsByTerm: Record<Term, ScheduledMeeting[]>,
  buildings?: Record<string, Coordinates>,
): Transfer[] {
  const transfers: Transfer[] = [];

  for (const term of TERMS) {
    for (const day of DAY_NUMBERS) {
      const meetings = meetingsByTerm[term].filter((meeting) => meeting.day === day);

      for (let index = 0; index < meetings.length - 1; index += 1) {
        const current = meetings[index];
        const next = meetings[index + 1];
        if (!current || !next) {
          continue;
        }

        const gapMin = meetingStartMinutes(next.meeting) - meetingEndMinutes(current.meeting);
        if (gapMin < 0) {
          continue;
        }

        transfers.push({
          term,
          day,
          from: current.label,
          to: next.label,
          gapMin,
          walkMin: transferWalkMinutes(current, next, buildings),
        });
      }
    }
  }

  return transfers.sort(
    (a, b) =>
      a.day - b.day ||
      a.gapMin - b.gapMin ||
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to) ||
      a.term.localeCompare(b.term),
  );
}

function transferWalkMinutes(
  current: ScheduledMeeting,
  next: ScheduledMeeting,
  buildings?: Record<string, Coordinates>,
): number | null {
  const currentCode = current.meeting.building.buildingCode;
  const nextCode = next.meeting.building.buildingCode;

  if (currentCode && nextCode && currentCode === nextCode) {
    return 0;
  }

  const currentCoordinates = currentCode ? buildings?.[currentCode] : undefined;
  const nextCoordinates = nextCode ? buildings?.[nextCode] : undefined;

  if (!currentCoordinates || !nextCoordinates) {
    return null;
  }

  return walkMinutes(currentCoordinates, nextCoordinates);
}

function largestFreeBlockMinutes(
  startMillis: number,
  endMillis: number,
  busy: Array<{ start: number; end: number }>,
): number {
  let cursor = startMillis;
  let largest = 0;

  for (const interval of busy) {
    if (interval.end <= cursor) {
      continue;
    }

    largest = Math.max(largest, millisToMinutes(interval.start - cursor));
    cursor = Math.max(cursor, interval.end);
  }

  largest = Math.max(largest, millisToMinutes(endMillis - cursor));
  return Math.max(0, largest);
}

function daysForMeetings(meetings: ScheduledMeeting[]): DayNumber[] {
  return sortDays(new Set(meetings.map((meeting) => meeting.day)));
}

function compareScheduledMeetings(first: ScheduledMeeting, second: ScheduledMeeting): number {
  return (
    first.day - second.day ||
    first.startMillis - second.startMillis ||
    first.endMillis - second.endMillis ||
    first.label.localeCompare(second.label)
  );
}

function compareTightTransfers(first: TightTransfer, second: TightTransfer): number {
  return (
    first.day - second.day ||
    first.gapMin - second.gapMin ||
    first.from.localeCompare(second.from) ||
    first.to.localeCompare(second.to)
  );
}

function shouldSkipHardRule(rule: RuleConfig, options: HardRuleOptions): boolean {
  if (rule.kind === "compactness") {
    return true;
  }

  return options.partial && rule.kind === "max-gap";
}

function metric(ruleId: string, penalty: number, detail: string): RuleMetric {
  return {
    ruleId,
    penalty: clamp01(penalty),
    detail,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(0, Math.min(1, value));
}

