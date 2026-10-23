import { describe, test, expect } from "vitest";
import { layoutTimedEvents, getAllDayEvents, HOUR_ROW_HEIGHT } from "../../lib/calendar-layout";

describe("calendar-layout", () => {
  // Guards the `env: { TZ: "UTC" }` pin in vitest.config.ts. The cases below
  // use `-04:00` fixtures, so on a machine set to US/Eastern they'd pass even
  // if the implementation read an event's wall clock through the runtime's
  // local accessors instead of the string's own offset — the exact bug that
  // broke every non-Eastern event on Vercel (where Node runs as UTC). If this
  // assertion ever fails, the pin was removed and the rest of this file has
  // stopped testing what it claims to.
  test("the suite runs under TZ=UTC, so these -04:00 fixtures can't pass by coincidence", () => {
    expect(new Date(2026, 9, 22).getTimezoneOffset()).toBe(0);
  });

  test("layoutTimedEvents positions a 9:00-9:15 AM event at the correct pixel offset", () => {
    const event = {
      id: "1",
      calendarId: "primary",
      summary: "Team standup",
      start: { dateTime: "2026-10-22T09:00:00-04:00" },
      end: { dateTime: "2026-10-22T09:15:00-04:00" },
    };
    const [positioned] = layoutTimedEvents([event], new Date(2026, 9, 22));
    expect(positioned.top).toBe(2 * HOUR_ROW_HEIGHT); // 2 hours after 7 AM
    expect(positioned.height).toBe(HOUR_ROW_HEIGHT * 0.25); // 15 minutes
  });

  test("layoutTimedEvents excludes an event entirely before the visible window", () => {
    const event = {
      id: "2",
      calendarId: "primary",
      summary: "Early flight",
      start: { dateTime: "2026-10-22T06:15:00-04:00" },
      end: { dateTime: "2026-10-22T06:45:00-04:00" },
    };
    expect(layoutTimedEvents([event], new Date(2026, 9, 22))).toEqual([]);
  });

  test("layoutTimedEvents excludes all-day events, routing them to getAllDayEvents instead", () => {
    const allDay = {
      id: "3",
      calendarId: "primary",
      summary: "Mom's birthday",
      start: { date: "2026-10-25" },
      end: { date: "2026-10-26" },
    };
    expect(layoutTimedEvents([allDay], new Date(2026, 9, 25))).toEqual([]);
    expect(getAllDayEvents([allDay], new Date(2026, 9, 25))).toEqual([allDay]);
  });

  test("layoutTimedEvents keeps a late-evening event on its own calendar day, not the server's", () => {
    // 9 PM Eastern on Oct 22 is already Oct 23 in UTC. Reading the wall clock
    // through the runtime's accessors would move this event to the next day's
    // column (and to hour 1, outside the grid, hiding it entirely); reading
    // the string's own offset keeps it where Google says it is.
    const event = {
      id: "5",
      calendarId: "primary",
      summary: "Late call",
      start: { dateTime: "2026-10-22T21:00:00-04:00" },
      end: { dateTime: "2026-10-22T21:30:00-04:00" },
    };
    const [positioned] = layoutTimedEvents([event], new Date(2026, 9, 22));
    expect(positioned.top).toBe(14 * HOUR_ROW_HEIGHT); // 14 hours after 7 AM
    expect(layoutTimedEvents([event], new Date(2026, 9, 23))).toEqual([]);
  });

  test("layoutTimedEvents honors each event's own offset, not just the fixtures' -04:00", () => {
    const tokyoEvent = {
      id: "6",
      calendarId: "primary",
      summary: "Tokyo sync",
      start: { dateTime: "2026-10-22T09:00:00+09:00" },
      end: { dateTime: "2026-10-22T10:00:00+09:00" },
    };
    const [positioned] = layoutTimedEvents([tokyoEvent], new Date(2026, 9, 22));
    expect(positioned.top).toBe(2 * HOUR_ROW_HEIGHT); // 9 AM in its own timezone
    expect(positioned.height).toBe(HOUR_ROW_HEIGHT);
  });

  test("layoutTimedEvents only includes events that fall on the given day", () => {
    const otherDay = {
      id: "4",
      calendarId: "primary",
      summary: "Tomorrow's standup",
      start: { dateTime: "2026-10-23T09:00:00-04:00" },
      end: { dateTime: "2026-10-23T09:15:00-04:00" },
    };
    expect(layoutTimedEvents([otherDay], new Date(2026, 9, 22))).toEqual([]);
  });
});
