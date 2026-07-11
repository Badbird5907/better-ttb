import type { DayNumber, MeetingTime } from "@better-ttb/shared";

import { CALENDAR_TIME_ZONE, TERM_DATE_BOUNDS } from "@/lib/term-dates";
import {
  activeMeetingsForTerm,
  courseAppliesToTerm,
  type SelectedTimetableSection,
  type Term,
} from "@/lib/timetable";

interface BuildIcsOptions {
  calendarName: string;
  selectedSections: readonly SelectedTimetableSection[];
  now?: Date;
}

const TERMS: Term[] = ["fall", "winter"];
const CRLF = "\r\n";

export function buildIcsCalendar({
  calendarName,
  selectedSections,
  now = new Date(),
}: BuildIcsOptions): string {
  const dtstamp = formatUtcDateTime(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//better-ttb//Timetable Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    ...vtimezoneLines(),
  ];

  selectedSections.forEach((selection) => {
    TERMS.forEach((term) => {
      if (!courseAppliesToTerm(selection.course.sectionCode, term)) {
        return;
      }

      activeMeetingsForTerm(selection.section, term).forEach((meeting, index) => {
        lines.push(
          ...eventLines({
            selection,
            term,
            meeting,
            meetingIndex: index,
            dtstamp,
          }),
        );
      });
    });
  });

  lines.push("END:VCALENDAR");

  return `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
}

export function foldIcsLine(line: string): string {
  if (line.length <= 75) {
    return line;
  }

  const chunks: string[] = [];
  let rest = line;

  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }

  chunks.push(rest);
  return chunks.join(CRLF);
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function eventLines({
  selection,
  term,
  meeting,
  meetingIndex,
  dtstamp,
}: {
  selection: SelectedTimetableSection;
  term: Term;
  meeting: MeetingTime;
  meetingIndex: number;
  dtstamp: string;
}): string[] {
  const firstDate = firstMeetingDate(term, meeting.start.day, meeting.repetitionTime);
  const until = `${compactDate(TERM_DATE_BOUNDS[term].end)}T235959Z`;
  const interval = isAlternatingMeeting(meeting) ? ";INTERVAL=2" : "";
  const location = formatLocation(meeting);
  const summary = `${selection.course.code} ${selection.section.name}`;
  const description = `${selection.course.name}\n${selection.teachMethod} ${selection.section.name}`;

  return [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uidFor(selection, term, meetingIndex))}`,
    `DTSTAMP:${dtstamp}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
    `DTSTART;TZID=${CALENDAR_TIME_ZONE}:${dateTimeForMeeting(firstDate, meeting.start.millisofday)}`,
    `DTEND;TZID=${CALENDAR_TIME_ZONE}:${dateTimeForMeeting(firstDate, meeting.end.millisofday)}`,
    `RRULE:FREQ=WEEKLY${interval};UNTIL=${until}`,
    "END:VEVENT",
  ];
}

function firstMeetingDate(
  term: Term,
  day: DayNumber,
  repetitionTime: MeetingTime["repetitionTime"],
): string {
  const first = firstDateOnOrAfter(TERM_DATE_BOUNDS[term].start, day);

  if (repetitionTime === "SECOND_AND_FOURTH_WEEK") {
    return addDays(first, 7);
  }

  return first;
}

function firstDateOnOrAfter(startIsoDate: string, day: DayNumber): string {
  let date = parseIsoDate(startIsoDate);

  while (dayNumberForDate(date) !== day) {
    date = addUtcDays(date, 1);
  }

  return formatIsoDate(date);
}

function dateTimeForMeeting(isoDate: string, millisofday: number): string {
  const totalMinutes = Math.floor(millisofday / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${compactDate(isoDate)}T${hours.toString().padStart(2, "0")}${minutes
    .toString()
    .padStart(2, "0")}00`;
}

function isAlternatingMeeting(meeting: MeetingTime): boolean {
  return (
    meeting.repetitionTime === "FIRST_AND_THIRD_WEEK" ||
    meeting.repetitionTime === "SECOND_AND_FOURTH_WEEK"
  );
}

function uidFor(
  selection: SelectedTimetableSection,
  term: Term,
  meetingIndex: number,
): string {
  return `${selection.course.code}-${selection.section.name}-${term}-${meetingIndex}@better-ttb`;
}

function formatLocation(meeting: MeetingTime): string {
  const code = meeting.building.buildingCode;
  const room = `${meeting.building.buildingRoomNumber}${meeting.building.buildingRoomSuffix}`.trim();

  return `${code}${room ? ` ${room}` : ""}`.trim();
}

function vtimezoneLines(): string[] {
  return [
    "BEGIN:VTIMEZONE",
    `TZID:${CALENDAR_TIME_ZONE}`,
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

function formatUtcDateTime(date: Date): string {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}${date.getUTCDate().toString().padStart(2, "0")}T${date
    .getUTCHours()
    .toString()
    .padStart(2, "0")}${date.getUTCMinutes().toString().padStart(2, "0")}${date
    .getUTCSeconds()
    .toString()
    .padStart(2, "0")}Z`;
}

function compactDate(isoDate: string): string {
  return isoDate.replaceAll("-", "");
}

function addDays(isoDate: string, days: number): string {
  return formatIsoDate(addUtcDays(parseIsoDate(isoDate), days));
}

function parseIsoDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);

  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dayNumberForDate(date: Date): DayNumber {
  const day = date.getUTCDay();
  return (day === 0 ? 7 : day) as DayNumber;
}

function formatIsoDate(date: Date): string {
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}
