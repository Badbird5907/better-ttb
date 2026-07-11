import type { DayNumber, MeetingTime } from "./ttb-api";

export const MILLIS_PER_MINUTE = 60_000;
export const FALL_2026 = "20269";
export const WINTER_2027 = "20271";
export const YEAR = `${FALL_2026}-${WINTER_2027}`;

const DAY_LABELS: Record<DayNumber, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

export interface ParsedSessionCode {
  year: number;
  term: "fall" | "winter" | "summer" | "year";
}

export function millisofdayToHHMM(millisofday: number): string {
  if (!Number.isInteger(millisofday) || millisofday < 0) {
    throw new RangeError("millisofday must be a non-negative integer");
  }

  const totalMinutes = Math.floor(millisofday / MILLIS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 23 || minutes > 59) {
    throw new RangeError("millisofday must be within a single day");
  }

  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;
}

export function formatDay(day: DayNumber): string {
  return DAY_LABELS[day];
}

export function meetingTimesOverlap(left: MeetingTime, right: MeetingTime): boolean {
  return (
    left.start.day === right.start.day &&
    left.start.millisofday < right.end.millisofday &&
    right.start.millisofday < left.end.millisofday
  );
}

export function parseSessionCode(sessionCode: string): ParsedSessionCode {
  if (sessionCode.includes("-")) {
    const [start, end] = sessionCode.split("-");
    if (!start || !end) {
      throw new Error(`Invalid year session code: ${sessionCode}`);
    }

    return {
      year: parseSessionCode(start).year,
      term: "year",
    };
  }

  if (!/^\d{5}$/.test(sessionCode)) {
    throw new Error(`Invalid session code: ${sessionCode}`);
  }

  const year = Number.parseInt(sessionCode.slice(0, 4), 10);
  const termDigit = sessionCode.at(4);

  if (termDigit === "9") {
    return { year, term: "fall" };
  }

  if (termDigit === "1") {
    return { year, term: "winter" };
  }

  if (termDigit === "5") {
    return { year, term: "summer" };
  }

  throw new Error(`Unsupported session term digit: ${termDigit}`);
}

export function formatSessionLabel(sessionCode: string): string {
  const parsed = parseSessionCode(sessionCode);

  if (parsed.term === "year") {
    return sessionCode
      .split("-")
      .map((code) => formatSessionLabel(code))
      .join(" / ");
  }

  const label = parsed.term[0]?.toUpperCase() + parsed.term.slice(1);
  return `${label} ${parsed.year}`;
}
