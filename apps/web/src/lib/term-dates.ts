export const TERM_DATE_BOUNDS = {
  fall: {
    // TODO: Fetch real academic dates from the registrar instead of using phase constants.
    start: "2026-09-08",
    end: "2026-12-08",
  },
  winter: {
    // TODO: Fetch real academic dates from the registrar instead of using phase constants.
    start: "2027-01-11",
    end: "2027-04-09",
  },
} as const;

export const CALENDAR_TIME_ZONE = "America/Toronto";
