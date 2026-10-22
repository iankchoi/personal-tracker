import { describe, test, expect } from "vitest";
import { layoutTimedEvents, getAllDayEvents, HOUR_ROW_HEIGHT } from "../../lib/calendar-layout";

describe("calendar-layout", () => {
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
