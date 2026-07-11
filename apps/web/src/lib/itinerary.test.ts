import type { Course, MeetingTime, Section, SectionCode, TeachMethod } from "@better-ttb/shared";
import { describe, expect, it } from "vitest";

import {
  buildDayItinerary,
  classifyTransfer,
  daysWithClasses,
  hasTightTransfer,
  type BuildingIndex,
} from "./itinerary";
import { selectedSectionKey, type SelectedTimetableSection } from "./timetable";

// Real UofT coordinates so walkMinutes produces realistic values.
const BUILDINGS: BuildingIndex = {
  BA: { name: "Bahen Centre", lat: 43.65977, lng: -79.39708 },
  MP: { name: "McLennan Physical Labs", lat: 43.66206, lng: -79.39775 },
  SS: { name: "Sidney Smith Hall", lat: 43.66278, lng: -79.39818 },
  // Deliberately far away so a short gap becomes an impossible walk.
  FAR: { name: "Far Away Hall", lat: 43.7, lng: -79.35 },
};

describe("buildDayItinerary", () => {
  it("orders stops chronologically and numbers markers", () => {
    const selections = [
      section("CSC108H1", "F", "LEC", "LEC0201", meeting(1, "11:00", "12:00", "MP", "203")),
      section("MAT137Y1", "Y", "LEC", "LEC0101", meeting(1, "10:00", "11:00", "BA", "1130")),
    ];

    const itinerary = buildDayItinerary(selections, BUILDINGS, "fall", 1);

    expect(itinerary.markers.map((marker) => marker.buildingCode)).toEqual(["BA", "MP"]);
    expect(itinerary.markers.map((marker) => marker.index)).toEqual([1, 2]);
    expect(itinerary.markers[0]!.stops[0]!.courseCode).toBe("MAT137Y1");
  });

  it("collapses consecutive same-building stops into one marker", () => {
    const selections = [
      section("AAA100H1", "F", "LEC", "LEC0101", meeting(2, "09:00", "10:00", "SS", "1085")),
      section("BBB100H1", "F", "TUT", "TUT0101", meeting(2, "10:00", "11:00", "SS", "2118")),
      section("CCC100H1", "F", "LEC", "LEC0101", meeting(2, "11:00", "12:00", "BA", "B024")),
    ];

    const itinerary = buildDayItinerary(selections, BUILDINGS, "fall", 2);

    expect(itinerary.markers).toHaveLength(2);
    expect(itinerary.markers[0]!.buildingCode).toBe("SS");
    expect(itinerary.markers[0]!.stops).toHaveLength(2);
    expect(itinerary.markers[1]!.buildingCode).toBe("BA");
    // No transfer between the two SS classes (same building).
    expect(itinerary.transfers).toHaveLength(1);
    expect(itinerary.transfers[0]!.from.buildingCode).toBe("SS");
    expect(itinerary.transfers[0]!.to.buildingCode).toBe("BA");
  });

  it("computes gap, walk, and total walking minutes for transfers", () => {
    const selections = [
      section("MAT137Y1", "Y", "LEC", "LEC0101", meeting(1, "10:00", "11:00", "BA", "1130")),
      section("CSC108H1", "F", "LEC", "LEC0201", meeting(1, "11:00", "12:00", "MP", "203")),
    ];

    const itinerary = buildDayItinerary(selections, BUILDINGS, "fall", 1);

    expect(itinerary.transfers).toHaveLength(1);
    const transfer = itinerary.transfers[0]!;
    expect(transfer.gapMin).toBe(0);
    expect(transfer.walkMin).toBeGreaterThan(0);
    expect(itinerary.totalWalkMinutes).toBe(transfer.walkMin);
    // Zero gap but a nonzero walk means it cannot be made in time.
    expect(transfer.severity).toBe("tight");
  });

  it("classifies transfers as ok, warn, and tight", () => {
    expect(classifyTransfer(60, 5)).toBe("ok");
    // walk <= gap * 0.75 is comfortable.
    expect(classifyTransfer(20, 15)).toBe("ok");
    // walk > gap * 0.75 but <= gap.
    expect(classifyTransfer(10, 8)).toBe("warn");
    // walk == gap: arriving exactly on time is still cutting it close.
    expect(classifyTransfer(10, 10)).toBe("warn");
    // walk > gap.
    expect(classifyTransfer(5, 6)).toBe("tight");
  });

  it("collects unknown building codes and keeps them off the map", () => {
    const selections = [
      section("XYZ100H1", "F", "LEC", "LEC0101", meeting(3, "09:00", "10:00", "ZZ", "100")),
      section("BA100H1", "F", "LEC", "LEC0101", meeting(3, "10:00", "11:00", "BA", "1130")),
    ];

    const itinerary = buildDayItinerary(selections, BUILDINGS, "fall", 3);

    expect(itinerary.markers).toHaveLength(1);
    expect(itinerary.markers[0]!.buildingCode).toBe("BA");
    expect(itinerary.unknownLocations).toEqual([
      { buildingCode: "ZZ", courseCode: "XYZ100H1", sectionName: "LEC0101" },
    ]);
    // Unknown-building meeting cannot participate in a transfer.
    expect(itinerary.transfers).toHaveLength(0);
  });

  it("skips online meetings with no building code", () => {
    const selections = [
      section("ONL100H1", "F", "LEC", "LEC0101", meeting(4, "09:00", "10:00", "", "")),
    ];

    const itinerary = buildDayItinerary(selections, BUILDINGS, "fall", 4);

    expect(itinerary.markers).toHaveLength(0);
    expect(itinerary.unknownLocations).toHaveLength(0);
  });

  it("respects the term filter for fall-only and winter-only courses", () => {
    const selections = [
      section("FALL100H1", "F", "LEC", "LEC0101", meeting(1, "09:00", "10:00", "BA", "1", "20269")),
      section("WNTR100H1", "S", "LEC", "LEC0101", meeting(1, "09:00", "10:00", "MP", "2", "20271")),
    ];

    expect(buildDayItinerary(selections, BUILDINGS, "fall", 1).markers).toHaveLength(1);
    expect(buildDayItinerary(selections, BUILDINGS, "fall", 1).markers[0]!.buildingCode).toBe("BA");
    expect(buildDayItinerary(selections, BUILDINGS, "winter", 1).markers[0]!.buildingCode).toBe("MP");
  });

  it("detects tight transfers and enumerates days with classes", () => {
    const selections = [
      section("MAT137Y1", "Y", "LEC", "LEC0101", meeting(1, "10:00", "11:00", "BA", "1130")),
      section("CSC108H1", "F", "LEC", "LEC0201", meeting(1, "11:05", "12:00", "FAR", "203")),
      section("SOLO100H1", "F", "LEC", "LEC0101", meeting(3, "09:00", "10:00", "SS", "1085")),
    ];

    expect(hasTightTransfer(selections, BUILDINGS, "fall")).toBe(true);
    expect(daysWithClasses(selections, BUILDINGS, "fall")).toEqual([1, 3]);
  });
});

function section(
  courseCode: string,
  sectionCode: SectionCode,
  teachMethod: TeachMethod,
  sectionName: string,
  ...meetings: MeetingTime[]
): SelectedTimetableSection {
  const sec: Section = {
    name: sectionName,
    type: "Lecture",
    teachMethod,
    sectionNumber: sectionName.replace(/\D/g, ""),
    meetingTimes: meetings,
    instructors: [],
    currentEnrolment: 0,
    maxEnrolment: 100,
    currentWaitlist: 0,
    waitlistInd: "N",
    cancelInd: "N",
    enrolmentInd: "",
    tbaInd: "N",
    openLimitInd: "",
    deliveryModes: [{ session: "20269", mode: "INPER" }],
    subTitle: "",
    notes: [],
    enrolmentControls: [],
    linkedMeetingSections: null,
  };
  const course: Course = {
    code: courseCode,
    sectionCode,
    name: `${courseCode} course`,
    maxCredit: 0.5,
    sections: [sec],
  } as unknown as Course;

  return {
    key: selectedSectionKey({ courseCode, sectionCode }, teachMethod, sectionName),
    courseKey: `${courseCode}:${sectionCode}`,
    course,
    pinned: { courseCode, sectionCode, chosen: {} },
    teachMethod,
    section: sec,
  };
}

function meeting(
  day: 1 | 2 | 3 | 4 | 5 | 6 | 7,
  start: string,
  end: string,
  buildingCode: string,
  room: string,
  sessionCode = "20269",
): MeetingTime {
  return {
    start: { day, millisofday: hhmmToMillis(start) },
    end: { day, millisofday: hhmmToMillis(end) },
    building: {
      buildingCode,
      buildingRoomNumber: room,
      buildingRoomSuffix: "",
      buildingUrl: "",
      buildingName: null,
    },
    sessionCode,
    repetitionTime: "ONCE_A_WEEK",
  };
}

function hhmmToMillis(hhmm: string): number {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return ((hours ?? 0) * 60 + (minutes ?? 0)) * 60_000;
}
