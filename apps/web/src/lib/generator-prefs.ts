import type { DayNumber, DeliveryMode } from "@better-ttb/shared";
import type { RuleConfig } from "@better-ttb/generator";

import type { BlockedWindow } from "@/components/timetable/WeekGrid";

export type RuleKind = RuleConfig["kind"];

export const RULE_KIND_ORDER: RuleKind[] = [
  "max-gap",
  "max-walk",
  "blocked-times",
  "earliest-start",
  "latest-end",
  "days-off",
  "compactness",
  "lunch-break",
  "avoid-full-sections",
  "avoid-waitlist",
  "prefer-delivery",
  "prefer-instructor",
];

export const RULE_LABELS: Record<RuleKind, string> = {
  "max-gap": "Max gap",
  "max-walk": "Max walk",
  "blocked-times": "Blocked times",
  "earliest-start": "Earliest start",
  "latest-end": "Latest end",
  "days-off": "Days off",
  compactness: "Compactness",
  "lunch-break": "Lunch break",
  "avoid-full-sections": "Avoid full sections",
  "avoid-waitlist": "Avoid waitlist",
  "prefer-delivery": "Prefer delivery",
  "prefer-instructor": "Prefer instructor",
};

export const RULE_DESCRIPTIONS: Record<RuleKind, string> = {
  "max-gap": "Limits how long you wait between classes on the same day.",
  "max-walk": "Limits walking time between back-to-back classes.",
  "blocked-times": "Keeps classes out of times you've painted as unavailable.",
  "earliest-start": "Avoids classes that start before your chosen time.",
  "latest-end": "Avoids classes that run past your chosen time.",
  "days-off": "Tries to keep whole days free of classes.",
  compactness: "Prefers tightly packed days or spread-out days.",
  "lunch-break": "Keeps a free block for lunch within your chosen window.",
  "avoid-full-sections": "Steers away from sections with no seats left.",
  "avoid-waitlist": "Steers away from sections where you'd be waitlisted.",
  "prefer-delivery": "Favours sections taught in your preferred format.",
  "prefer-instructor": "Favours sections taught by instructors you list.",
};

export const DELIVERY_MODE_OPTIONS: Array<{ value: DeliveryMode; label: string }> = [
  { value: "INPER", label: "In person" },
  { value: "SYNC", label: "Online sync" },
  { value: "ASYNC", label: "Async" },
  { value: "HYBR", label: "Hybrid" },
];

export const DAY_OPTIONS: Array<{ value: DayNumber; label: string }> = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export function createDefaultRule(kind: RuleKind): RuleConfig {
  const base = {
    id: `${kind}-${createId()}`,
    kind,
    mode: "soft" as const,
    weight: 0.5,
  };

  switch (kind) {
    case "max-gap":
      return { ...base, kind, maxGapMinutes: 120 };
    case "max-walk":
      return { ...base, kind, maxWalkMinutes: 12 };
    case "blocked-times":
      return { ...base, kind, mode: "hard", weight: 1, windows: [] };
    case "earliest-start":
      return { ...base, kind, millisofday: minutesToMillis(9 * 60) };
    case "latest-end":
      return { ...base, kind, millisofday: minutesToMillis(18 * 60) };
    case "days-off":
      return { ...base, kind, count: 1 };
    case "compactness":
      return { ...base, kind, preference: "compact" };
    case "lunch-break":
      return {
        ...base,
        kind,
        startMillis: minutesToMillis(12 * 60),
        endMillis: minutesToMillis(14 * 60),
        minMinutes: 30,
      };
    case "avoid-full-sections":
      return { ...base, kind };
    case "avoid-waitlist":
      return { ...base, kind };
    case "prefer-delivery":
      return { ...base, kind, modes: ["INPER"] };
    case "prefer-instructor":
      return { ...base, kind, names: [] };
  }
}

export function blockedWindowsFromRules(rules: readonly RuleConfig[]): BlockedWindow[] {
  return rules
    .filter((rule): rule is Extract<RuleConfig, { kind: "blocked-times" }> =>
      rule.kind === "blocked-times",
    )
    .flatMap((rule) => rule.windows);
}

export function ensureBlockedTimesRule(rules: readonly RuleConfig[]): RuleConfig[] {
  if (rules.some((rule) => rule.kind === "blocked-times")) {
    return [...rules];
  }

  return [...rules, createDefaultRule("blocked-times")];
}

export function toggleBlockedCell(
  rules: readonly RuleConfig[],
  day: DayNumber,
  startMillis: number,
  endMillis: number,
): RuleConfig[] {
  const withRule = ensureBlockedTimesRule(rules);

  return withRule.map((rule) => {
    if (rule.kind !== "blocked-times") {
      return rule;
    }

    const windows = toggleWindow(rule.windows, {
      day,
      startMillis,
      endMillis,
    });

    return {
      ...rule,
      windows,
    };
  });
}

export function updateRuleById(
  rules: readonly RuleConfig[],
  ruleId: string,
  updater: (rule: RuleConfig) => RuleConfig,
): RuleConfig[] {
  return rules.map((rule) => (rule.id === ruleId ? updater(rule) : rule));
}

export function removeRuleById(
  rules: readonly RuleConfig[],
  ruleId: string,
): RuleConfig[] {
  return rules.filter((rule) => rule.id !== ruleId);
}

export function minutesToMillis(minutes: number): number {
  return minutes * 60 * 1000;
}

export function millisToMinutes(millis: number): number {
  return Math.round(millis / 60_000);
}

function toggleWindow(
  windows: readonly BlockedWindow[],
  cell: BlockedWindow,
): BlockedWindow[] {
  const containing = windows.find(
    (window) =>
      window.day === cell.day &&
      window.startMillis <= cell.startMillis &&
      window.endMillis >= cell.endMillis,
  );

  if (containing) {
    return mergeWindows(
      windows.flatMap((window) => {
        if (window !== containing) {
          return [window];
        }

        return [
          {
            day: window.day,
            startMillis: window.startMillis,
            endMillis: cell.startMillis,
          },
          {
            day: window.day,
            startMillis: cell.endMillis,
            endMillis: window.endMillis,
          },
        ].filter((entry) => entry.endMillis > entry.startMillis);
      }),
    );
  }

  return mergeWindows([...windows, cell]);
}

function mergeWindows(windows: readonly BlockedWindow[]): BlockedWindow[] {
  const sorted = [...windows]
    .filter((window) => window.endMillis > window.startMillis)
    .sort(
      (left, right) =>
        left.day - right.day ||
        left.startMillis - right.startMillis ||
        left.endMillis - right.endMillis,
    );
  const merged: BlockedWindow[] = [];

  sorted.forEach((window) => {
    const last = merged.at(-1);

    if (last && last.day === window.day && window.startMillis <= last.endMillis) {
      last.endMillis = Math.max(last.endMillis, window.endMillis);
      return;
    }

    merged.push({ ...window });
  });

  return merged;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2, 10);
}
