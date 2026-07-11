import { walkMinutes, type Coordinates } from "@better-ttb/generator";
import type { DayNumber, MeetingTime } from "@better-ttb/shared";

import {
  activeMeetingsForTerm,
  colorForCourse,
  courseAppliesToTerm,
  type SelectedTimetableSection,
  type Term,
} from "@/lib/timetable";

/** How a transfer's timing compares against the walk it requires. */
export type TransferSeverity = "ok" | "warn" | "tight";

export interface BuildingLookup {
  /** Full building name, e.g. "Bahen Centre". */
  name: string;
  lat: number;
  lng: number;
}

/** Coordinates keyed by building code, plus display names. */
export type BuildingIndex = Record<string, BuildingLookup>;

/** A single in-person class meeting on the selected day, in chronological order. */
export interface ItineraryStop {
  key: string;
  courseCode: string;
  sectionName: string;
  teachMethod: string;
  color: string;
  buildingCode: string;
  buildingName: string | null;
  room: string;
  startMillis: number;
  endMillis: number;
  coordinates: Coordinates;
}

/**
 * A marker on the map. Consecutive stops in the same building collapse into a
 * single marker carrying every stop that occurs there.
 */
export interface ItineraryMarker {
  /** 1-based chronological index used for the numbered pin label. */
  index: number;
  buildingCode: string;
  buildingName: string | null;
  coordinates: Coordinates;
  stops: ItineraryStop[];
}

/** A walk between two consecutive class buildings. */
export interface ItineraryTransfer {
  from: ItineraryStop;
  to: ItineraryStop;
  /** Free minutes between the end of `from` and the start of `to`. */
  gapMin: number;
  /** Estimated walking minutes between the two buildings. */
  walkMin: number;
  severity: TransferSeverity;
}

/** A meeting whose building code is not present in the buildings dataset. */
export interface UnknownLocation {
  buildingCode: string;
  courseCode: string;
  sectionName: string;
}

export interface DayItinerary {
  term: Term;
  day: DayNumber;
  markers: ItineraryMarker[];
  transfers: ItineraryTransfer[];
  unknownLocations: UnknownLocation[];
  /** Sum of all transfer walk minutes for the day. */
  totalWalkMinutes: number;
}

const MILLIS_PER_MINUTE = 60_000;
/** A transfer is "tight" when the required walk exceeds the available gap. */
const WARN_RATIO = 0.75;

/**
 * Builds the ordered, fully-resolved itinerary for a single term + weekday from
 * the plan's chosen sections. Pure and leaflet-free so it can be unit tested and
 * reused by the map component.
 */
export function buildDayItinerary(
  selectedSections: readonly SelectedTimetableSection[],
  buildings: BuildingIndex,
  term: Term,
  day: DayNumber,
): DayItinerary {
  const stops: ItineraryStop[] = [];
  const unknownLocations: UnknownLocation[] = [];

  selectedSections.forEach((selected) => {
    if (!courseAppliesToTerm(selected.course.sectionCode, term)) {
      return;
    }

    activeMeetingsForTerm(selected.section, term).forEach((meeting, index) => {
      if (meeting.start.day !== day) {
        return;
      }

      const buildingCode = meeting.building.buildingCode.trim();

      if (!buildingCode) {
        // Fully online / no assigned room: nothing to place on the map.
        return;
      }

      const lookup = buildings[buildingCode];

      if (!lookup) {
        unknownLocations.push({
          buildingCode,
          courseCode: selected.course.code,
          sectionName: selected.section.name,
        });
        return;
      }

      stops.push({
        key: `${selected.key}:${index}`,
        courseCode: selected.course.code,
        sectionName: selected.section.name,
        teachMethod: selected.teachMethod,
        color: colorForCourse(selected.course.code),
        buildingCode,
        buildingName: lookup.name,
        room: formatRoom(meeting),
        startMillis: meeting.start.millisofday,
        endMillis: meeting.end.millisofday,
        coordinates: { lat: lookup.lat, lng: lookup.lng },
      });
    });
  });

  stops.sort(
    (left, right) =>
      left.startMillis - right.startMillis ||
      left.endMillis - right.endMillis ||
      left.key.localeCompare(right.key),
  );

  const markers = buildMarkers(stops);
  const transfers = buildTransfers(stops);
  const totalWalkMinutes = roundMinutes(
    transfers.reduce((total, transfer) => total + transfer.walkMin, 0),
  );

  return {
    term,
    day,
    markers,
    transfers,
    unknownLocations: dedupeUnknown(unknownLocations),
    totalWalkMinutes,
  };
}

/** Collapses runs of consecutive same-building stops into single numbered markers. */
function buildMarkers(stops: readonly ItineraryStop[]): ItineraryMarker[] {
  const markers: ItineraryMarker[] = [];

  stops.forEach((stop) => {
    const previous = markers[markers.length - 1];

    if (previous && previous.buildingCode === stop.buildingCode) {
      previous.stops.push(stop);
      return;
    }

    markers.push({
      index: markers.length + 1,
      buildingCode: stop.buildingCode,
      buildingName: stop.buildingName,
      coordinates: stop.coordinates,
      stops: [stop],
    });
  });

  return markers;
}

/** Computes walks between consecutive stops in different buildings. */
function buildTransfers(stops: readonly ItineraryStop[]): ItineraryTransfer[] {
  const transfers: ItineraryTransfer[] = [];

  for (let index = 1; index < stops.length; index += 1) {
    const from = stops[index - 1]!;
    const to = stops[index]!;

    if (from.buildingCode === to.buildingCode) {
      continue;
    }

    const gapMin = roundMinutes((to.startMillis - from.endMillis) / MILLIS_PER_MINUTE);
    const walkMin = roundMinutes(walkMinutes(from.coordinates, to.coordinates));

    transfers.push({
      from,
      to,
      gapMin,
      walkMin,
      severity: classifyTransfer(gapMin, walkMin),
    });
  }

  return transfers;
}

/**
 * Classifies a transfer:
 * - `tight` when the walk cannot be completed within the gap (walk > gap),
 * - `warn` when the walk eats into most of the gap (walk > gap * 0.75),
 * - `ok` otherwise.
 */
export function classifyTransfer(gapMin: number, walkMin: number): TransferSeverity {
  if (walkMin > gapMin) {
    return "tight";
  }

  if (walkMin > gapMin * WARN_RATIO) {
    return "warn";
  }

  return "ok";
}

/** Whether the given term has any tight transfer across the school week. */
export function hasTightTransfer(
  selectedSections: readonly SelectedTimetableSection[],
  buildings: BuildingIndex,
  term: Term,
): boolean {
  return ALL_DAYS.some((day) =>
    buildDayItinerary(selectedSections, buildings, term, day).transfers.some(
      (transfer) => transfer.severity === "tight",
    ),
  );
}

/** Days (Mon..Sun) on which the term has at least one placed in-person class. */
export function daysWithClasses(
  selectedSections: readonly SelectedTimetableSection[],
  buildings: BuildingIndex,
  term: Term,
): DayNumber[] {
  return ALL_DAYS.filter(
    (day) => buildDayItinerary(selectedSections, buildings, term, day).markers.length > 0,
  );
}

export const ALL_DAYS: readonly DayNumber[] = [1, 2, 3, 4, 5, 6, 7];

function dedupeUnknown(unknown: readonly UnknownLocation[]): UnknownLocation[] {
  const seen = new Set<string>();
  const result: UnknownLocation[] = [];

  unknown.forEach((entry) => {
    const key = `${entry.buildingCode}:${entry.courseCode}:${entry.sectionName}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    result.push(entry);
  });

  return result;
}

function formatRoom(meeting: MeetingTime): string {
  const code = meeting.building.buildingCode;
  const number = meeting.building.buildingRoomNumber;
  const suffix = meeting.building.buildingRoomSuffix;
  const room = `${number}${suffix}`.trim();

  if (!code && !room) {
    return "TBA";
  }

  return `${code}${room ? ` ${room}` : ""}`.trim();
}

function roundMinutes(minutes: number): number {
  return Number(minutes.toFixed(1));
}
